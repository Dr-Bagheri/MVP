/**
 * Is `agent_run.steps` QUERYABLE — not merely present? (steward directive)
 *
 * The bug: `$n::jsonb` with a JSON string makes postgres.js encode it a
 * second time, so every array element lands as a jsonb STRING rather than an
 * object. `select steps` looks correct. `jsonb_array_elements(steps)->>'tool'`
 * returns null, so the audit trail cannot answer "which tools did this run
 * call" — the first question anyone asks it (invariant 5).
 *
 * The assertion is therefore SQL, against a row this script actually wrote.
 * A JS-side check would pass on the broken shape: `JSON.parse` of a
 * double-encoded string succeeds, which is exactly why three modules shipped
 * it and only a database question found it.
 *
 * Not vitest: needs a real connection and writes rows.
 *
 *   ECHO_APP_DB_URL=… node --experimental-strip-types test/e2e/jsonb-queryable.ts
 */
import postgres from "postgres";

import { createAgentRunStore } from "../../src/agent/run-store.ts";
import { createDb, type SqlClient } from "../../src/db/identity.ts";
import type { Identity } from "../../src/agent/types.ts";

const url = process.env.ECHO_APP_DB_URL;
/**
 * BOTH credentials, and the agent one is not optional.
 *
 * `AgentRunStore` writes on the echo_agent role — that is the point of it,
 * since echo_agent holds UPDATE on only (status, steps, tokens_in,
 * tokens_out, error, finished_at) while echo_app can rewrite the whole row.
 * Handing it the app pool fails with `permission denied to set role
 * "echo_agent"`, which is the in-transaction role assertion doing exactly
 * what it was added for. My first version of this script made that mistake
 * — the same one Backend 2's harness made — and the loud failure is why it
 * took a minute rather than an afternoon.
 */
const agentUrl = process.env.ECHO_AGENT_DB_URL;
if (!url || !agentUrl) {
  console.error("ECHO_APP_DB_URL and ECHO_AGENT_DB_URL are required (read them from the secret store)");
  process.exit(2);
}

/** Backend 3's seeded dev identity — an ACTIVE member, or RLS denies everything. */
const ACTOR = process.env.ECHO_DEV_ACTOR ?? "0d000000-0000-4000-8000-000000000002";
const ORG = process.env.ECHO_DEV_ORG ?? "0d000000-0000-4000-8000-00000000000d";

const pool = postgres(url, { max: 2 }) as unknown as SqlClient;
const agentPool = postgres(agentUrl, { max: 2 }) as unknown as SqlClient;
const raw = postgres(url, { max: 1 });
const db = createDb({ app: pool, agent: agentPool });
const identity: Identity = { userId: ACTOR, orgId: ORG, role: "member", isActive: true };

let failures = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`  ok   ${what}`);
  else { failures += 1; console.error(`  FAIL ${what}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
};

const step = (seq: number, tool: string) => ({
  seq, tool, args: { query: "انحصاری اکو" }, outcome: "ok" as const,
  ms: 12, startedAt: "2026-08-12T00:00:00.000Z",
});

let runId: string | undefined;
try {
  const store = createAgentRunStore({ db, identity });
  runId = await store.begin({
    orgId: ORG, actorId: ACTOR, callId: null, skillId: null,
    kind: "assistant", model: "google/gemini-3.6-flash",
    request: { systemPrompt: "p", input: "q", tools: ["search_transcripts"], skill: null },
  });
  await store.appendStep(runId, step(0, "search_transcripts"));
  await store.appendStep(runId, step(1, "list_related_calls"));

  const id = runId;
  console.log("agent_run.steps");
  await raw.begin(async (tx) => {
    // Same two statements the connection factory issues, in the same order.
    // Without `set local role` first, set_config on the custom GUC is refused
    // with 42501 — the role assertion is not decoration here either.
    await tx.unsafe("set local role echo_app");
    await tx.unsafe("select set_config('echo.actor_id', $1, true)", [ACTOR]);

    // THE assertion: answer the question the audit trail exists for.
    const tools = await tx.unsafe<{ tool: string | null }[]>(
      `select jsonb_array_elements(steps)->>'tool' as tool
         from echo.agent_run where id = $1`,
      [id],
    );
    check(
      "SQL can answer 'which tools did this run call'",
      tools.map((r) => r.tool).join(",") === "search_transcripts,list_related_calls",
      tools.map((r) => r.tool),
    );

    // Element TYPE, stated directly — this is what was wrong, and a null
    // `tool` above could in principle have other causes.
    const kinds = await tx.unsafe<{ kind: string }[]>(
      `select distinct jsonb_typeof(e) as kind
         from echo.agent_run, jsonb_array_elements(steps) e where id = $1`,
      [id],
    );
    check("every element is an OBJECT, not a string", kinds.length === 1 && kinds[0]?.kind === "object", kinds);

    // The append is one element per step, not one array per step.
    const [len] = await tx.unsafe<{ n: number }[]>(
      `select jsonb_array_length(steps) as n from echo.agent_run where id = $1`, [id],
    );
    check("two steps appended as two elements", Number(len?.n) === 2, len?.n);

    // `request` used the same broken cast and gets the same question.
    const [req] = await tx.unsafe<{ kind: string; first: string | null }[]>(
      `select jsonb_typeof(request) as kind, request->'tools'->>0 as first
         from echo.agent_run where id = $1`,
      [id],
    );
    check("request is a queryable object too", req?.kind === "object", req?.kind);
    check("and its nested array is reachable", req?.first === "search_transcripts", req?.first);
  });

  // Sweep: are there rows left double-encoded by earlier dev runs?
  console.log("legacy rows");
  const [legacy] = await raw.unsafe<{ n: string }[]>(
    `select count(*) as n from echo.agent_run
      where exists (select 1 from jsonb_array_elements(steps) e
                     where jsonb_typeof(e) <> 'object')`,
  );
  check("no double-encoded rows remain on this project", Number(legacy?.n) === 0, legacy?.n);
} finally {
  if (runId) {
    // echo_app holds no DELETE anywhere, by design — so this row stays. It is
    // an honest record of a real run, and leaving it is cheaper than granting
    // a delete for tidiness.
    console.log(`\n(left run ${runId} in place — echo_app has no DELETE grant, by design)`);
  }
  await raw.end();
  await pool.end();
  await agentPool.end();
}

console.log(failures === 0 ? "\njsonb queryability: OK" : `\njsonb queryability: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
