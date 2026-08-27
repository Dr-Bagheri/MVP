/**
 * M41 P1+P3+P4 — starting, deciding and reading workflow RUNS.
 *
 * Triggers here: MANUAL (the person pressing Run is the subject — W1
 * trivially) and SIGNAL (an inbound fact presented by its owner; the
 * dedup unique makes a repeated signal one run). EVENT rides the worker's
 * pipeline site; SCHEDULE rides the 0108 doors — both enqueue exactly the
 * way this file does, as the owner.
 *
 * THE DECISION (P3/W14) is made on the run, by the RUN'S OWNER, and
 * nobody else: an admin can cancel a member's run and can never approve
 * its writes — approval is consent, and the consent is the subject's.
 * The insert is the replay wall (one PK, one 23505 → 409); the resume is
 * push-fast (flip to running, then enqueue the parked step — the order is
 * load-bearing, because the executor consumes messages for waiting runs
 * as strays) with the 0108 sweep as the belt for a crash in the gap.
 *
 * The EXECUTABLE gate: a workflow needing a kind the executor cannot run
 * yet is refused AT STEP 0, recorded on the ledger as a `refused` run
 * naming the kinds — "you pressed it and nothing happened" is the failure
 * mode this engine exists to never have.
 */
import { ConflictError, NotActivatedError, NotFoundError, ValidationError } from "./errors.ts";
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
  /** P3: the human's answer on a proposal step, when one exists */
  decision?: string;
}

export function createWorkflowRunsRepo(db: Db) {
  const queue = createQueue(db);

  /** shared by the manual and signal triggers — both run AS the caller */
  async function startWith(
    identity: Identity,
    ref: string,
    triggerKind: "manual" | "signal",
    triggerRef: string | null,
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

    let runId: string;
    try {
      const created = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.workflow_run
             (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind, trigger_ref)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [identity.orgId, identity.userId, workflow.id, workflow.current_version_id,
            triggerKind, triggerRef],
        ));
      runId = created[0]?.id ?? "";
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        // W26: the same fact is already live — one run per fact, said so
        throw new ConflictError("a run for this item is already in flight",
          { code: "run_already_live" });
      }
      throw error;
    }
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
  }

  return {
    /** The runnable catalogue: enabled, published, member-visible. */
    async catalogue(identity: Identity): Promise<
      { id: string; handle: string; name: string; description: string }[]
    > {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select id, handle, name, description from echo.workflow
            where enabled and current_version_id is not null and archived_at is null
            order by created_at`));
      return rows.map((row) => ({
        id: String(row.id), handle: String(row.handle),
        name: String(row.name), description: String(row.description ?? ""),
      }));
    },

    /** Press Run — the manual trigger. */
    async start(identity: Identity, ref: string): Promise<{ run_id: string; status: string }> {
      return startWith(identity, ref, "manual", null);
    },

    /**
     * P4 — the SIGNAL trigger: an inbound fact, presented by its owner
     * (the recorder, an integration through the BFF — never an API key).
     */
    async signal(
      identity: Identity, ref: string, sourceRef: unknown,
    ): Promise<{ run_id: string; status: string }> {
      const value = typeof sourceRef === "string" ? sourceRef.trim() : "";
      if (value === "" || value.length > 200) {
        throw new ValidationError("source_ref is required (at most 200 chars)");
      }
      return startWith(identity, ref, "signal", value);
    },

    /**
     * P3 — THE DECISION (W14). See the header: owner-only, replay-walled,
     * resume push-first.
     */
    async decide(
      identity: Identity,
      runId: string,
      input: { step_id?: unknown; decision?: unknown },
    ): Promise<{ decision: string; resumed: boolean }> {
      const stepId = typeof input.step_id === "string" ? input.step_id : "";
      const decision = input.decision;
      if (decision !== "approve" && decision !== "reject") {
        throw new ValidationError("decision must be approve or reject");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ owner_id: string; org_id: string; status: string }>(
          `select owner_id, org_id, status from echo.workflow_run where id = $1`,
          [runId]));
      const run = rows[0];
      if (!run) throw new NotFoundError("no such run");
      if (run.owner_id !== identity.userId) {
        throw new NotActivatedError("only the run's owner decides its proposals");
      }
      const proposeRows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; output: unknown }>(
          `select s.id, o.output
             from echo.workflow_step_run s
             join echo.workflow_step_output o on o.step_run_id = s.id
            where s.run_id = $1 and s.step_id = $2 and s.iteration = 0
              and s.status = 'done'`,
          [runId, stepId]));
      const proposeRun = proposeRows[0];
      const proposal = proposeRun?.output as
        | { proposal?: string; call_id?: string } | undefined;
      if (!proposeRun || typeof proposal?.proposal !== "string") {
        throw new NotFoundError("no proposal stands at that step");
      }
      try {
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(
            `insert into echo.proposal_decision
               (proposal_id, org_id, call_id, kind, decision, decided_by)
             values ($1, $2, $3, $4, $5, $6)`,
            [proposeRun.id, run.org_id, proposal.call_id ?? null,
              proposal.proposal, decision, identity.userId]));
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("this proposal is already decided",
            { code: "already_decided" });
        }
        throw error;
      }
      let resumed = false;
      if (run.status === "waiting") {
        await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe(
            `update echo.workflow_run
                set status = 'running', waiting_on = null
              where id = $1 and status = 'waiting'`, [runId]));
        const parked = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<{ step_id: string; iteration: number }>(
            `select step_id, iteration from echo.workflow_step_run
              where run_id = $1 and status = 'running'
              order by started_at desc limit 1`, [runId]));
        if (parked[0]) {
          await queue.send(Q_WORKFLOW_STEP, {
            runId, stepId: parked[0].step_id, iteration: parked[0].iteration,
            ownerId: identity.userId, orgId: identity.orgId,
          });
          resumed = true;
        }
      }
      return { decision, resumed };
    },

    /** P4 — a standing cadence; the run executes as the schedule's OWNER.
        v1 timing is UTC, on the record — never a hidden guess about
        anyone's midnight. */
    async schedule(
      identity: Identity,
      ref: string,
      input: { cadence?: unknown; at_minute?: unknown; weekday?: unknown; owner_id?: unknown },
    ): Promise<{ schedule_id: string; next_due: string }> {
      const cadence = input.cadence;
      if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
        throw new ValidationError("cadence must be daily, weekly or monthly");
      }
      const atMinute = typeof input.at_minute === "number"
        && Number.isInteger(input.at_minute)
        && input.at_minute >= 0 && input.at_minute < 1440
        ? input.at_minute : 480;
      const ownerId = typeof input.owner_id === "string" && input.owner_id !== ""
        ? input.owner_id : identity.userId;
      const found = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          UUID.test(ref)
            ? `select id from echo.workflow where id = $1 and archived_at is null`
            : `select id from echo.workflow where handle = $1 and archived_at is null`,
          [ref]));
      if (!found[0]) throw new NotFoundError("no such workflow");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; next_due: string }>(
          `insert into echo.workflow_schedule
             (org_id, owner_id, workflow_id, cadence, at_minute, weekday, next_due)
           values ($1, $2, $3, $4, $5, $6,
             case when date_trunc('day', now()) + make_interval(mins => $5) > now()
                  then date_trunc('day', now()) + make_interval(mins => $5)
                  else date_trunc('day', now()) + interval '1 day' + make_interval(mins => $5)
             end)
           returning id, next_due`,
          [identity.orgId, ownerId, found[0]!.id, cadence, atMinute,
            typeof input.weekday === "number" ? input.weekday : null]));
      const row = rows[0];
      if (!row) throw new NotFoundError("schedule not created — the wall refused it");
      return { schedule_id: row.id, next_due: iso(row.next_due) };
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

    /** One run + its ledger; outputs and decisions only where the walls
        let them through. */
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
                  o.output, pd.decision::text as decision
             from echo.workflow_step_run s
             left join echo.workflow_step_output o on o.step_run_id = s.id
             left join echo.proposal_decision pd on pd.proposal_id = s.id
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
          ...(row.output !== null && row.output !== undefined ? { output: row.output } : {}),
          ...(typeof row.decision === "string" ? { decision: row.decision } : {}),
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
