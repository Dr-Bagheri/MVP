#!/usr/bin/env node
/**
 * probe-run-request — what a run actually SENT, part by part (READ-ONLY).
 *
 * `agent_run.request` keeps the prompt a model was given: the system text,
 * the tool schemas, the messages. `tokens_in` is the provider's count of
 * all of it together, and a count that moves the wrong way — the
 * 2026-09-19 schema diet cut 8.5k characters from the client registry and
 * the next measured turn cost MORE input tokens than the one before it —
 * cannot be explained from the total. This prints each top-level key of the
 * recorded request with its serialised size, the tool count and the total
 * characters of the tools array, beside `tokens_in`, so two runs can be
 * compared part by part.
 *
 * Owner altitude (the rows belong to every organisation), in a transaction
 * declared READ ONLY so a typo cannot become a write. Never content: sizes
 * and counts only — the system prompt is org-authored text and the messages
 * are a colleague's conversation; this prints neither.
 *
 *   NEURAI_PYTHON=<venv python> node db/scripts/probe-run-request.mjs --at 2026-09-19T11:30:17Z [--at <iso> …]
 *   … --last 3          the newest three assistant runs instead
 *
 * `--at` matches a run whose `started_at` is within one second of the
 * instant, which is how the budget probe prints them.
 */
import { execFileSync } from "node:child_process";
import { findNeuraiPython } from "./lib/neurai-python.mjs";
import { ownerClient } from "./lib/owner-url.mjs";

const ats = [];
let last = 0;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--at" && process.argv[i + 1]) ats.push(process.argv[++i]);
  else if (process.argv[i] === "--last" && process.argv[i + 1]) last = Number(process.argv[++i]);
}
if (ats.length === 0 && last === 0) last = 3;

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

  const where = ats.length > 0
    ? `where ${ats.map((_, i) => `abs(extract(epoch from (started_at - $${i + 1}::timestamptz))) < 1`).join(" or ")}`
    : `where kind = 'assistant' order by started_at desc limit ${last}`;
  const runs = await client.query(
    `select id, started_at, model, status::text as status, tokens_in, tokens_out, kind,
            length(request::text) as request_chars,
            jsonb_array_length(coalesce(request->'tools', '[]'::jsonb)) as tools,
            length((request->'tools')::text) as tools_chars,
            (select jsonb_object_agg(k, length((request->k)::text)) from jsonb_object_keys(request) k) as part_chars,
            (select jsonb_object_agg(k, jsonb_typeof(request->k)) from jsonb_object_keys(request) k) as part_types,
            jsonb_array_length(coalesce(steps, '[]'::jsonb)) as steps
       from echo.agent_run
       ${where}
       ${ats.length > 0 ? "order by started_at desc" : ""}`,
    ats,
  );
  if (runs.rows.length === 0) { console.log("(no matching runs)"); }
  for (const r of runs.rows) {
    console.log(`\n== ${new Date(r.started_at).toISOString()}  ${r.model}  ${r.status}  tokens_in=${r.tokens_in ?? "-"}  tokens_out=${r.tokens_out ?? "-"}  steps=${r.steps}`);
    console.log(`   request ${r.request_chars} chars · tools ${r.tools} (${r.tools_chars ?? 0} chars)`);
    const parts = r.part_chars ?? {};
    const types = r.part_types ?? {};
    for (const key of Object.keys(parts).sort((a, b) => parts[b] - parts[a])) {
      console.log(`   ${key.padEnd(18)} ${String(parts[key]).padStart(7)} chars  ${types[key]}`);
    }
    /* the tools, by size — names and schema sizes only, never a description */
    const tools = await client.query(
      `select coalesce(t->'function'->>'name', t->>'name') as name, length(t::text) as chars
         from echo.agent_run r, jsonb_array_elements(coalesce(r.request->'tools','[]'::jsonb)) t
        where r.id = $1 order by length(t::text) desc limit 5`,
      [r.id],
    );
    if (tools.rows.length > 0) {
      console.log(`   largest tools: ${tools.rows.map((t) => `${t.name} ${t.chars}`).join(" · ")}`);
    }
  }
  await client.query("rollback");
} finally {
  await client.end();
}
