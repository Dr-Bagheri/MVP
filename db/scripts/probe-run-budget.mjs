/**
 * READ-ONLY. What an assistant turn COSTS on production, in the run ledger's
 * own numbers — and the shape of `meeting_item` before its kinds change.
 *
 * Two questions, one probe, because both are answered only at owner altitude
 * (rule 11: an inventory read below the wall is true only for the reader):
 *
 *   · `tokens_in` per `agent_run`, grouped by kind and by how many tools the
 *     run was offered — the BEFORE and AFTER of the tool-schema diet
 *     (2026-09-19). A diet measured on the serialised registry alone is a
 *     measurement of the source; this is the measurement of what the provider
 *     billed. Pass `--since <iso>` to split the window at a deploy instant.
 *   · the `meeting_item` kind CHECK by name and definition, and a census of
 *     rows per kind — whether a kind may be DROPPED from the check is a fact
 *     about the rows, and the migration that widens it needs the constraint's
 *     real name rather than the one its author assumes.
 *
 * Numbers, names and ids only — never a prompt, never a body. The connection
 * string comes from the DPAPI store the way db.mjs reads it (or DATABASE_URL);
 * the transaction is rolled back in a `finally`, and there is no COMMIT here.
 *
 *   NEURAI_PYTHON=<venv python> node db/scripts/probe-run-budget.mjs [--days 3] [--since 2026-09-19T12:00:00Z]
 */
import { execFileSync } from "node:child_process";
import { findNeuraiPython } from "./lib/neurai-python.mjs";
import { ownerClient } from "./lib/owner-url.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const DAYS = Number(arg("--days", "3"));
const SINCE = arg("--since", null);

function ownerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { path, reason } = findNeuraiPython();
  if (!path) throw new Error(reason);
  const out = execFileSync(path, [
    "-c",
    "import os;os.environ.setdefault('NEURAI_DATA_DIR',os.path.expanduser(r'~\\.neurai'));"
      + "from neurai.security import get_secret;print(get_secret('echo_platform_db_url') or '',end='')",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!out) throw new Error("the store holds no echo_platform_db_url");
  return out;
}

const client = await ownerClient(ownerUrl());
try {
  await client.query("begin");
  await client.query("set transaction read only");

  const who = await client.query("select current_user, current_database()");
  console.log(`connected as ${who.rows[0].current_user} to ${who.rows[0].current_database}`);

  console.log("\n== meeting_item: the check constraints, by their REAL names ==");
  const checks = await client.query(
    `select conname, pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'echo.meeting_item'::regclass and contype = 'c'
      order by conname`,
  );
  for (const r of checks.rows) console.log(`  ${r.conname}: ${r.def}`);

  console.log("\n== meeting_item: rows per kind (all organisations) ==");
  const census = await client.query(
    "select kind, count(*)::int as n from echo.meeting_item group by kind order by kind",
  );
  if (census.rows.length === 0) console.log("  (no rows at all)");
  for (const r of census.rows) console.log(`  ${r.kind.padEnd(10)} ${r.n}`);

  const windowSql = `started_at > now() - ($1::int * interval '1 day')`;
  const bucket = `case
      when jsonb_array_length(coalesce(request->'tools','[]'::jsonb)) = 0 then '0'
      when jsonb_array_length(coalesce(request->'tools','[]'::jsonb)) <= 40 then '1-40'
      when jsonb_array_length(coalesce(request->'tools','[]'::jsonb)) <= 90 then '41-90'
      else '91+' end`;

  async function report(label, extra, params) {
    console.log(`\n== agent_run ${label}: last ${DAYS} days, tokens_in known ==`);
    const byKind = await client.query(
      `select kind, count(*)::int as n,
              round(avg(tokens_in))::int as avg_in,
              percentile_cont(0.5) within group (order by tokens_in)::int as p50_in,
              round(avg(tokens_out))::int as avg_out,
              round(avg(jsonb_array_length(coalesce(request->'tools','[]'::jsonb))))::int as avg_tools,
              min(started_at) as first, max(started_at) as last
         from echo.agent_run
        where ${windowSql} and tokens_in is not null ${extra}
        group by kind order by kind`,
      params,
    );
    if (byKind.rows.length === 0) { console.log("  (no runs in the window)"); return; }
    console.log("  kind        n   avg_in  p50_in  avg_out  avg_tools  first → last");
    for (const r of byKind.rows) {
      console.log(`  ${String(r.kind).padEnd(10)} ${String(r.n).padStart(3)}  ${String(r.avg_in).padStart(6)}  ${String(r.p50_in).padStart(6)}  ${String(r.avg_out).padStart(7)}  ${String(r.avg_tools).padStart(9)}  ${r.first.toISOString()} → ${r.last.toISOString()}`);
    }
    const byTools = await client.query(
      `select ${bucket} as tools, count(*)::int as n,
              round(avg(tokens_in))::int as avg_in,
              percentile_cont(0.5) within group (order by tokens_in)::int as p50_in,
              min(tokens_in)::int as min_in, max(tokens_in)::int as max_in
         from echo.agent_run
        where ${windowSql} and tokens_in is not null and kind = 'assistant' ${extra}
        group by 1 order by 1`,
      params,
    );
    console.log("  assistant runs by tools offered:");
    console.log("  tools   n   avg_in  p50_in   min_in   max_in");
    for (const r of byTools.rows) {
      console.log(`  ${String(r.tools).padEnd(6)} ${String(r.n).padStart(3)}  ${String(r.avg_in).padStart(6)}  ${String(r.p50_in).padStart(6)}  ${String(r.min_in).padStart(7)}  ${String(r.max_in).padStart(7)}`);
    }
  }

  if (SINCE === null) {
    await report("(whole window)", "", [DAYS]);
  } else {
    await report(`BEFORE ${SINCE}`, "and started_at < $2::timestamptz", [DAYS, SINCE]);
    await report(`AFTER ${SINCE}`, "and started_at >= $2::timestamptz", [DAYS, SINCE]);
  }

  /*
   * THE ROWS BEHIND THE AVERAGES. The first run of this probe reported a
   * median `tokens_in` of 12 and a minimum of 3 for runs offered ninety-odd
   * tools — a number no real prompt can cost, so before an average is
   * believed the rows are listed by MODEL: a provider that reports only the
   * uncached part of a prompt makes `tokens_in` a measurement of the cache,
   * not of the prompt, and an "after" that looks smaller would then be
   * proving nothing about the diet.
   */
  if (process.argv.includes("--rows")) {
    console.log("\n== the last 40 assistant runs, one line each (numbers and the model id only) ==");
    const rows = await client.query(
      `select started_at, model, status::text as status,
              jsonb_array_length(coalesce(request->'tools','[]'::jsonb))::int as tools,
              tokens_in, tokens_out,
              (request->>'historyTurns')::int as history,
              (request->>'sessionContextChars')::int as ctx_chars,
              jsonb_array_length(coalesce(steps,'[]'::jsonb))::int as steps
         from echo.agent_run
        where kind = 'assistant'
        order by started_at desc
        limit 40`,
    );
    console.log("  started              model                               status  tools  in      out   hist  ctx    steps");
    for (const r of rows.rows) {
      console.log(`  ${r.started_at.toISOString().slice(0, 19)}  ${String(r.model ?? "-").padEnd(34)}  ${String(r.status).padEnd(6)}  ${String(r.tools).padStart(5)}  ${String(r.tokens_in ?? "-").padStart(6)}  ${String(r.tokens_out ?? "-").padStart(5)}  ${String(r.history ?? "-").padStart(4)}  ${String(r.ctx_chars ?? "-").padStart(5)}  ${String(r.steps).padStart(5)}`);
    }
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
