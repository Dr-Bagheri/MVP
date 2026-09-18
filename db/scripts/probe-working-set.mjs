/**
 * READ-ONLY. Runs the working-set parser over REAL production `agent_run.steps`
 * and prints what it finds.
 *
 * Why this and not a unit test: the field map in core/src/agent/subjects.ts is
 * hand-written — which argument names a subject is a judgement about each
 * tool's shape — and its first draft read three argument names no tool takes.
 * The unit test pins those names against the live registry, which catches a
 * RENAME. What it cannot catch is the map being right about the registry and
 * wrong about the rows: a tool whose arguments in practice carry no title, a
 * step shape written by an older worker, a kind nothing ever produces.
 *
 * So this asks the only source that can answer: the rows themselves.
 *
 * It opens a transaction and rolls it back in a `finally`; there is no COMMIT
 * in this file. Run it with the repo's `.env` (which is PRODUCTION):
 *
 *   node db/scripts/probe-working-set.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/* the repo's own .env, read whole — Node's --env-file truncates a value at a
   `#`, and this project's owner password contains one */
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

/** percent-encode the password the way core's normalizeDbUrl does */
function normalize(url) {
  const m = /^(postgres(?:ql)?:\/\/)([^:]+):([^@]*)@(.+)$/.exec(url);
  return m === null ? url : `${m[1]}${m[2]}:${encodeURIComponent(m[3])}@${m[4]}`;
}

const { subjectsFromSteps, workingSet, subjectBlock } =
  await import(pathToFileURL(join(root, "core", "src", "agent", "subjects.ts")).href);

const url = env.DATABASE_URL ?? env.ECHO_DB_OWNER_URL ?? env.SUPABASE_DB_URL;
if (url === undefined) {
  console.log("INVALID — no database URL in .env; the probe had no subject.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: normalize(url) });
await client.connect();
try {
  await client.query("begin");

  const { rows } = await client.query(
    `select r.id, r.status, jsonb_array_length(coalesce(r.steps,'[]'::jsonb)) as n, r.steps
       from echo.agent_run r
      where jsonb_array_length(coalesce(r.steps,'[]'::jsonb)) > 0
      order by r.started_at desc
      limit 40`,
  );

  if (rows.length === 0) {
    console.log("INVALID — no run on this database has ever recorded a step.");
    process.exit(1);
  }
  console.log(`read ${rows.length} runs that recorded steps\n`);

  let withSubjects = 0;
  const kinds = new Map();
  const toolsThatGaveNothing = new Map();

  for (const row of rows) {
    const found = subjectsFromSteps(row.steps);
    if (found.length > 0) withSubjects += 1;
    for (const s of found) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    if (found.length === 0) {
      for (const step of row.steps) {
        const tool = step && typeof step === "object" ? step.tool : null;
        if (typeof tool === "string") {
          toolsThatGaveNothing.set(tool, (toolsThatGaveNothing.get(tool) ?? 0) + 1);
        }
      }
    }
  }

  console.log(`runs that yielded at least one subject: ${withSubjects} / ${rows.length}`);
  console.log(`subjects by kind: ${JSON.stringify(Object.fromEntries(kinds))}\n`);

  /* THE HALF THAT MATTERS: a tool that appears in real rows and names nothing.
     Some of these are correct and expected — `list_tasks` takes no subject —
     and the point is to READ the list rather than assume it. */
  console.log("tools present in runs that produced NO subject (expected for list/read tools):");
  for (const [tool, n] of [...toolsThatGaveNothing].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(3)}  ${tool}`);
  }

  /* and one real block, so the shape a model would read is on the record.
     Titles are the ORG's content, so only the block's SIZE and its kinds are
     printed — never the words. */
  const recent = rows.slice(0, 4).map((r) => r.steps).reverse();
  const set = workingSet(recent);
  const block = subjectBlock(set, "fa");
  console.log(`\nworking set over the 4 newest runs: ${set.length} subjects`);
  console.log(`  kinds: ${JSON.stringify(set.map((s) => s.kind))}`);
  console.log(`  with an id: ${set.filter((s) => s.id !== undefined).length}`);
  console.log(`  block: ${block.length} chars, ${block === "" ? "EMPTY" : "composed"}`);
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
