/**
 * The postgres-backed AgentRunStore (invariant 5: agent runs are replayable).
 *
 * Shared deliberately: the api's assistant and the worker's summarizer are
 * the same runtime (M4), so they must record runs the same way. Two
 * implementations would drift, and the drift would only show up when someone
 * tried to replay a run and found the halves shaped differently.
 *
 * Identity discipline: every write goes through the connection factory with
 * the actor set, so RLS scopes the row to the caller and `agent_run.actor_id`
 * cannot disagree with who was actually acting. There is no service-account
 * path here — the summarizer runs as the call's owner (M3/M4).
 *
 * Steps are appended one at a time rather than written once at the end: a run
 * that dies mid-flight must still show what it had already done. That costs
 * one small UPDATE per tool call, which is the right trade for an audit trail
 * that survives a crash.
 */
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { AgentRunRecord, AgentRunStore, AgentStep, Identity } from "./types.ts";

const INSERT_RUN = `
  insert into echo.agent_run
    (org_id, actor_id, call_id, skill_id, kind, model, request, status)
  values ($1, $2, $3, $4, $5, $6, ${JSONB_PARAM(7)}, 'running')
  returning id
`;

/**
 * jsonb || jsonb appends to the array; doing it in SQL keeps the append atomic
 * under concurrent steps rather than read-modify-writing in JS.
 *
 * The cast is `::text::jsonb`, not `::jsonb` — see db/jsonb.ts. With plain
 * `::jsonb` the driver JSON-encodes the already-encoded string, every element
 * lands as a jsonb STRING rather than an object, and
 * `jsonb_array_elements(steps)->>'tool'` returns null. The row looks right;
 * the audit trail is unqueryable. Backend 2 found it running the two-call E2E
 * against a real database — nothing on this side could have.
 */
const APPEND_STEP = `
  update echo.agent_run
     set steps = steps || ${JSONB_PARAM(2)}
   where id = $1
`;

const FINISH_RUN = `
  update echo.agent_run
     set status      = $2,
         tokens_in   = $3,
         tokens_out  = $4,
         error       = $5,
         finished_at = now()
   where id = $1
`;

export interface RunStoreOptions {
  db: Db;
  identity: Identity;
}

/**
 * The run is the AGENT's audit trail, so it is written on the agent role.
 *
 * This is not tidiness. db/0014 grants `echo_agent` UPDATE on exactly
 * `(status, steps, tokens_in, tokens_out, error, finished_at)` — while
 * `echo_app` holds unrestricted UPDATE on the same table. Running these
 * writes as echo_app would leave `request`, `created_at` and `kind`
 * rewritable, and the append-only property this module is built around would
 * be enforced by nothing but this file's own choice of SQL.
 *
 * On the agent role, "no rewrite is expressible" stops being a claim about my
 * code and becomes a fact about the connection: the database would reject the
 * statement even if a future edit here tried to write it.
 */
const AGENT_ROLE = { role: "agent" } as const;

/**
 * One store per run context, bound to the identity the run acts as. Binding
 * at construction rather than per-call means a caller cannot accidentally
 * record someone else's run — the identity isn't a parameter to forget.
 */
export function createAgentRunStore({ db, identity }: RunStoreOptions): AgentRunStore {
  return {
    async begin(run): Promise<string> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(INSERT_RUN, [
          run.orgId,
          run.actorId,
          run.callId,
          run.skillId,
          run.kind,
          run.model,
          toJsonb(run.request ?? {}),
        ]),
        AGENT_ROLE,
      );
      const id = rows[0]?.id;
      if (!id) {
        // RLS returning nothing here means the actor could not insert a run
        // for that org — a bug or an attack, never a normal path.
        throw new Error("agent_run insert returned no row");
      }
      return id;
    },

    async appendStep(runId: string, step: AgentStep): Promise<void> {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(APPEND_STEP, [runId, toJsonb([step])]),
        AGENT_ROLE,
      );
    },

    async finish(runId, outcome): Promise<void> {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(FINISH_RUN, [
          runId,
          outcome.status,
          outcome.tokensIn ?? null,
          outcome.tokensOut ?? null,
          outcome.error ?? null,
        ]),
        AGENT_ROLE,
      );
    },
  };
}

/** Read side: the replay surface (invariant 5) and the budget-tuning data. */
export async function getAgentRun(
  db: Db, identity: Identity, runId: string,
): Promise<AgentRunRecord | undefined> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<Record<string, unknown>>(
      `select id, org_id, actor_id, call_id, skill_id, kind, status, model,
              request, steps, tokens_in, tokens_out, error
         from echo.agent_run
        where id = $1
        limit 1`,
      [runId],
    ),
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    actorId: row.actor_id as string,
    callId: (row.call_id as string | null) ?? null,
    skillId: (row.skill_id as string | null) ?? null,
    kind: row.kind as AgentRunRecord["kind"],
    status: row.status as AgentRunRecord["status"],
    model: row.model as string,
    request: row.request,
    steps: (row.steps as AgentStep[]) ?? [],
    tokensIn: (row.tokens_in as number | null) ?? null,
    tokensOut: (row.tokens_out as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}
