/**
 * M41 P1 — starting and reading workflow RUNS.
 *
 * The manual trigger (L1's first kind): the person pressing Run IS the
 * subject, so W1 is trivially satisfied here — owner = caller. The other
 * three trigger kinds arrive in P4 with their own enqueuers.
 *
 * The EXECUTABLE gate: a graph is validated at publish against the whole
 * vocabulary, but the executor grows phase by phase. A workflow needing a
 * kind the executor cannot run yet is refused AT STEP 0, naming the kinds
 * it needs — and the refusal is recorded ON THE LEDGER as a `refused` run,
 * because "you pressed it and nothing happened" is the failure mode this
 * engine exists to never have.
 *
 * Reads are shaped by the walls, not by this file: the runs list returns
 * whatever RLS shows (own runs; admins additionally the org's), and the
 * detail's outputs ride a LEFT JOIN against the owner-only produce table —
 * an admin's join naturally yields null output per row, which is W16
 * behaving, not data missing.
 */
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";
import { iso, isoOrNull, EXECUTABLE_STEP_KINDS } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { createQueue, Q_WORKFLOW_STEP } from "../worker/queue.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkflowRunRecord {
  id: string;
  workflow_id: string;
  workflow: string;
  owner_id: string;
  status: string;
  trigger_kind: string;
  failure_code: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface WorkflowStepRunRecord {
  step_id: string;
  iteration: number;
  status: string;
  failure_code: string | null;
  agent_run_id: string | null;
  model_cost: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
  /** present ONLY for the run's owner — the W16 wall, visible as a shape */
  output?: unknown;
}

export function createWorkflowRunsRepo(db: Db) {
  const queue = createQueue(db);

  return {
    /**
     * Press Run. Creates the run (owner = the caller), reads the program
     * through the 0107 door, gates on the executable set, enqueues step 1.
     */
    async start(
      identity: Identity,
      ref: string,
    ): Promise<{ run_id: string; status: string }> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; name: string; enabled: boolean; current_version_id: string | null }>(
          UUID.test(ref)
            ? `select id, name, enabled, current_version_id from echo.workflow
                where id = $1 and archived_at is null`
            : `select id, name, enabled, current_version_id from echo.workflow
                where handle = $1 and archived_at is null`,
          [ref],
        ));
      const workflow = rows[0];
      if (!workflow) throw new NotFoundError("no such workflow");
      if (!workflow.enabled) {
        throw new ConflictError("this workflow is disabled",
          { code: "workflow_disabled" });
      }
      if (!workflow.current_version_id) {
        throw new ConflictError("this workflow has no published version",
          { code: "workflow_unpublished" });
      }

      const created = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.workflow_run
             (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind)
           values ($1, $2, $3, $4, 'manual')
           returning id`,
          [identity.orgId, identity.userId, workflow.id, workflow.current_version_id],
        ));
      const runId = created[0]?.id;
      if (!runId) throw new Error("workflow_run insert returned no row");

      const door = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ graph: WorkflowGraph }>(
          `select graph from echo.workflow_graph_for_run($1)`, [runId]));
      const graph = door[0]?.graph;
      if (!graph) throw new Error("the just-created run's program did not come back through the door");

      const unrunnable = [...new Set(
        graph.steps
          .map((step) => step.kind)
          .filter((kind) => !(EXECUTABLE_STEP_KINDS as readonly string[]).includes(kind)),
      )];
      if (unrunnable.length > 0) {
        /* refused ON the ledger — the press left a visible, named answer */
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(
            `update echo.workflow_run
                set status = 'refused', failure_code = 'kind_unavailable', ended_at = now()
              where id = $1`, [runId]));
        throw new ValidationError(
          `this workflow needs step kinds not yet runnable: ${unrunnable.join(", ")}`,
          { code: "workflow_kind_unavailable", params: { kinds: unrunnable.join(", ") } },
        );
      }

      const entry = graph.steps.find((step) => step.id === graph.entry) ?? graph.steps[0]!;
      await queue.send(Q_WORKFLOW_STEP, {
        runId, stepId: entry.id, iteration: 0,
        ownerId: identity.userId, orgId: identity.orgId,
      });
      return { run_id: runId, status: "running" };
    },

    /** The list: RLS decides whose (own; admins also the org's). Keyset. */
    async list(
      identity: Identity,
      options: { before?: string | undefined; limit?: number | undefined } = {},
    ): Promise<WorkflowRunRecord[]> {
      const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select r.id, r.workflow_id, w.name as workflow, r.owner_id, r.status,
                  r.trigger_kind, r.failure_code, r.started_at, r.ended_at
             from echo.workflow_run r
             join echo.workflow w on w.id = r.workflow_id
            where ($2::timestamptz is null or r.started_at < $2::timestamptz)
            order by r.started_at desc
            limit $1`,
          [limit, options.before ?? null],
        ));
      return rows.map(toRun);
    },

    /** One run + its ledger; outputs only where the produce wall lets them through. */
    async detail(
      identity: Identity,
      runId: string,
    ): Promise<{ run: WorkflowRunRecord; steps: WorkflowStepRunRecord[] }> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select r.id, r.workflow_id, w.name as workflow, r.owner_id, r.status,
                  r.trigger_kind, r.failure_code, r.started_at, r.ended_at
             from echo.workflow_run r
             join echo.workflow w on w.id = r.workflow_id
            where r.id = $1`,
          [runId],
        ));
      const run = rows[0];
      if (!run) throw new NotFoundError("no such run");
      const steps = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select s.step_id, s.iteration, s.status, s.failure_code,
                  s.agent_run_id, s.model_cost, s.started_at, s.ended_at,
                  o.output
             from echo.workflow_step_run s
             left join echo.workflow_step_output o on o.step_run_id = s.id
            where s.run_id = $1
            order by s.started_at`,
          [runId],
        ));
      return {
        run: toRun(run),
        steps: steps.map((row) => ({
          step_id: String(row.step_id),
          iteration: Number(row.iteration),
          status: String(row.status),
          failure_code: (row.failure_code as string | null) ?? null,
          agent_run_id: (row.agent_run_id as string | null) ?? null,
          model_cost: (row.model_cost as Record<string, unknown> | null) ?? null,
          started_at: iso(row.started_at),
          ended_at: isoOrNull(row.ended_at),
          /* undefined (key absent) when the wall filtered it — the wire
             distinguishes "no output produced" from "not yours to read"
             by never conflating null with absent */
          ...(row.output !== null && row.output !== undefined ? { output: row.output } : {}),
        })),
      };
    },
  };
}

function toRun(row: Record<string, unknown>): WorkflowRunRecord {
  return {
    id: String(row.id),
    workflow_id: String(row.workflow_id),
    workflow: String(row.workflow),
    owner_id: String(row.owner_id),
    status: String(row.status),
    trigger_kind: String(row.trigger_kind),
    failure_code: (row.failure_code as string | null) ?? null,
    started_at: iso(row.started_at),
    ended_at: isoOrNull(row.ended_at),
  };
}
