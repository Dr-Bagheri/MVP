/**
 * M41 P4 — the trigger machinery the worker drives.
 *
 * EVENT: called from the pipeline site that produced the fact, already
 * running AS THE OWNER — so the query for subscribed workflows runs under
 * their RLS, the run is inserted as them, and W1 holds without a single
 * privileged read. The dedup unique makes a redelivered fact one run.
 * W28's cascade guard is STRUCTURAL here: the only workflow writes are
 * tags/title applies, which emit no facts — a workflow-produced fact
 * cannot exist in v1, and this file is the only event enqueuer.
 *
 * SWEEP: the belt under the push paths (0108 doors, metadata only).
 * Waits that a decision satisfied resume; waits nobody answered EXPIRE,
 * loudly, with a card — a question nobody answered is an answer. Due
 * schedules fire through the CAS exactly once per moment, each run
 * executing as its schedule's owner.
 */
import { resolveIdentity } from "../db/actor.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { Q_WORKFLOW_STEP, type Queue } from "./queue.ts";
import type { StepLogger } from "./runner.ts";

/** the pipeline's hook: fire the org's subscribed workflows for one fact */
export async function enqueueWorkflowEvents(
  db: Db,
  identity: Identity,
  event: string,
  callId: string,
  queue: Queue,
  log: StepLogger,
): Promise<void> {
  try {
    const workflows = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<{ id: string; version_id: string }>(
        `select w.id, w.current_version_id as version_id
           from echo.workflow w
          where w.trigger_event = $1 and w.enabled
            and w.archived_at is null and w.current_version_id is not null
            and not exists (
              select 1 from echo.workflow_mute m
               where m.workflow_id = w.id and m.owner_id = $2 and m.muted)`,
        [event, identity.userId]));
    for (const workflow of workflows) {
      const created = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.workflow_run
             (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind, trigger_ref)
           values ($1, $2, $3, $4, 'event', $5)
           on conflict do nothing
           returning id`,
          [identity.orgId, identity.userId, workflow.id, workflow.version_id, callId]));
      const runId = created[0]?.id;
      if (!runId) continue;                   // W26: this fact already ran
      const door = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ graph: { entry: string } }>(
          `select graph from echo.workflow_graph_for_run($1)`, [runId]));
      const entry = door[0]?.graph?.entry;
      if (!entry) continue;
      await queue.send(Q_WORKFLOW_STEP, {
        runId, stepId: entry, iteration: 0,
        ownerId: identity.userId, orgId: identity.orgId,
      });
      log.info({ event: "workflow_event_fired", workflow_id: workflow.id, run_id: runId },
        "event trigger fired");
    }
  } catch (error) {
    // best-effort BY DESIGN: a missing workflow must never fail the call
    // that just finished processing — the warn is the forfeit said out loud
    log.warn({ event: "workflow_event_enqueue_failed", detail: (error as Error).name },
      "workflow event triggers not enqueued");
  }
}

/** one pass of the belt: resume/expire waits, fire due schedules */
export async function sweepWorkflowTimers(
  db: Db,
  queue: Queue,
  log: StepLogger,
): Promise<void> {
  // ── waits ─────────────────────────────────────────────────────────────
  try {
    const waits = await db.withoutIdentity((tx) =>
      tx.unsafe<{ run_id: string; owner_id: string; org_id: string; step_id: string | null; verdict: string }>(
        "select run_id, owner_id, org_id, step_id, verdict from echo.due_workflow_waits()"));
    for (const wait of waits) {
      let identity: Identity;
      try {
        identity = await resolveIdentity(db, wait.owner_id);
      } catch {
        continue;                              // no owner, no product write
      }
      if (!identity.isActive) continue;        // heals on reinstatement
      if (wait.verdict === "expired") {
        await db.withIdentity(identity, async (tx: SqlTx) => {
          await tx.unsafe(
            `update echo.workflow_run
                set status = 'expired', ended_at = now()
              where id = $1 and status = 'waiting'`, [wait.run_id]);
          await tx.unsafe(
            `insert into echo.agent_card (org_id, owner_id, kind, title)
             select r.org_id, r.owner_id, 'workflow_result',
                    (select w.name from echo.workflow w where w.id = r.workflow_id)
               from echo.workflow_run r where r.id = $1`, [wait.run_id]);
        });
        log.warn({ event: "workflow_wait_expired", run_id: wait.run_id },
          "a question nobody answered is an answer — run expired");
        continue;
      }
      if (!wait.step_id) continue;
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.workflow_run
              set status = 'running', waiting_on = null
            where id = $1 and status = 'waiting'`, [wait.run_id]));
      await queue.send(Q_WORKFLOW_STEP, {
        runId: wait.run_id, stepId: wait.step_id, iteration: 0,
        ownerId: wait.owner_id, orgId: wait.org_id,
      });
      log.info({ event: "workflow_wait_resumed", run_id: wait.run_id },
        "wait resumed by the sweep — the push path's belt");
    }
  } catch (error) {
    log.warn({ event: "workflow_wait_sweep_failed", detail: (error as Error).name },
      "wait sweep failed");
  }

  // ── schedules ─────────────────────────────────────────────────────────
  try {
    const due = await db.withoutIdentity((tx) =>
      tx.unsafe<{ id: string; workflow_id: string; owner_id: string; org_id: string; next_due: string }>(
        "select id, workflow_id, owner_id, org_id, next_due from echo.due_workflow_schedules()"));
    for (const schedule of due) {
      /* 0111: no echoed timestamp — the due-predicate is the CAS. The
         0108 version compared microseconds to a millisecond round-trip and
         never matched; the live acceptance caught it, the suite could not
         (its value never crossed the wire). */
      const claimed = await db.withoutIdentity((tx) =>
        tx.unsafe<{ claim_workflow_fire: boolean | null }>(
          "select echo.claim_workflow_fire($1)", [schedule.id]));
      if (claimed[0]?.claim_workflow_fire !== true) continue;   // another pass won
      let identity: Identity;
      try {
        identity = await resolveIdentity(db, schedule.owner_id);
      } catch {
        continue;
      }
      if (!identity.isActive) continue;
      const created = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; version_id: string | null }>(
          `insert into echo.workflow_run
             (org_id, owner_id, workflow_id, workflow_version_id, trigger_kind, trigger_ref)
           select w.org_id, $2, w.id, w.current_version_id, 'schedule', $3
             from echo.workflow w
            where w.id = $1 and w.enabled and w.current_version_id is not null
           on conflict do nothing
           returning id, workflow_version_id as version_id`,
          [schedule.workflow_id, schedule.owner_id, schedule.id]));
      const runId = created[0]?.id;
      if (!runId) continue;                    // disabled, unpublished, or already live
      const door = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ graph: { entry: string } }>(
          `select graph from echo.workflow_graph_for_run($1)`, [runId]));
      const entry = door[0]?.graph?.entry;
      if (!entry) continue;
      await queue.send(Q_WORKFLOW_STEP, {
        runId, stepId: entry, iteration: 0,
        ownerId: schedule.owner_id, orgId: schedule.org_id,
      });
      log.info({ event: "workflow_schedule_fired", schedule_id: schedule.id, run_id: runId },
        "schedule fired");
    }
  } catch (error) {
    log.warn({ event: "workflow_schedule_sweep_failed", detail: (error as Error).name },
      "schedule sweep failed");
  }
}
