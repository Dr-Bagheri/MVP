/**
 * What a dead letter MEANS.
 *
 * The queue only knows a message failed too often. Whether that costs the
 * customer a minute of their meeting or the whole recording is a product
 * decision (M7), and it splits cleanly:
 *
 *   per-part step  → the part becomes a VISIBLE GAP. The call keeps going.
 *   per-call step  → the call is marked failed, visibly and resumably.
 *
 * Losing a 30-minute meeting because minute 12 failed is the worst outcome
 * available, and it is the one that happens by default if nobody writes this
 * file.
 */
import { identityForJob, resolveIdentity } from "../db/actor.ts";
import type { Db } from "../db/identity.ts";
import { allPartsMissing, partsSettled, type Lifecycle } from "./lifecycle.ts";
import {
  isSignalPayload,
  isWorkflowStepPayload,
  PART_QUEUES,
  Q_LINK_SPEAKERS,
  type JobPayload,
  type Queue,
  type QueueName,
  type QueuePayload,
} from "./queue.ts";
import type { DeadLetterSink, StepLogger } from "./runner.ts";

export interface DeadLetterOptions {
  db: Db;
  lifecycle: Lifecycle;
  queue: Queue;
  log: StepLogger;
}

const isPartQueue = (queue: QueueName): boolean =>
  (PART_QUEUES as readonly string[]).includes(queue);

export function createDeadLetterSink({ db, lifecycle, queue, log }: DeadLetterOptions): DeadLetterSink {
  return {
    async onDeadLetter(queueName, body: QueuePayload, info) {
      if (isSignalPayload(body)) {
        // M35: a dead signal costs one brief/digest, never anyone's data —
        // identifiers only, and the archived message is the replay handle.
        log.error(
          { queue: queueName, signal: body.event, owner_id: body.ownerId,
            org_id: body.orgId, rule_id: body.ruleId ?? null, call_id: body.callId ?? null,
            error_type: info.errorType, exhausted: info.exhausted },
          "agent signal dead-lettered",
        );
        return;
      }
      /*
       * M41: a dead-lettered workflow step is the loud half of §5.5 — the
       * run must not stay 'running' forever while its message rots in the
       * archive. Marked AS THE OWNER; an unresolvable owner gets the log
       * line only (invariant 2: no owner, no product write — the archived
       * message stays the replay handle).
       */
      if (isWorkflowStepPayload(body)) {
        log.error(
          { queue: queueName, run_id: body.runId, step_id: body.stepId,
            org_id: body.orgId, error_type: info.errorType, exhausted: info.exhausted },
          "workflow step dead-lettered",
        );
        try {
          const identity = await resolveIdentity(db, body.ownerId);
          await db.withIdentity(identity, async (tx) => {
            await tx.unsafe(
              `update echo.workflow_step_run
                  set status = 'failed', failure_code = 'step_dead_letter', ended_at = now()
                where run_id = $1 and step_id = $2 and iteration = $3 and status = 'running'`,
              [body.runId, body.stepId, body.iteration]);
            await tx.unsafe(
              `update echo.workflow_run
                  set status = 'failed', failure_code = 'step_dead_letter', ended_at = now()
                where id = $1 and status in ('running', 'waiting')`,
              [body.runId]);
          });
        } catch {
          // the owner is gone or inactive: the log line above is the trace
        }
        return;
      }

      const payload: JobPayload = body;
      let identity;
      try {
        identity = await identityForJob(db, payload);
      } catch (error) {
        // We cannot establish who this job belonged to, so we cannot write
        // anything under their identity — and we will not write it under
        // anyone else's. Invariant 2 keeps no convenience exception, not even
        // for bookkeeping.
        //
        // Which means the product database will hold NO record that this
        // happened. The archived message and this line are the only trace an
        // operator gets, so both carry every identifier needed to find the
        // work by hand — and no content, ever (Invariant 7).
        log.error(
          {
            queue: queueName,
            call_id: payload.callId,
            part_id: payload.partId ?? null,
            owner_id: payload.ownerId,
            error_type: info.errorType,
            reason: info.reason,
            exhausted: info.exhausted,
            unresolved_owner: true,
          },
          "DEAD LETTER UNRECORDED: owner could not be resolved; message archived, nothing marked in the database",
        );
        return;
      }

      if (isPartQueue(queueName) && payload.partId) {
        await lifecycle.markPartMissing(identity, payload.partId, `${info.errorType}: ${info.reason}`);
        log.warn(
          { call_id: payload.callId, part_id: payload.partId, error_type: info.errorType },
          "part written off as a gap; the call continues",
        );

        const parts = await lifecycle.partsOfCall(identity, payload.callId);

        // Every single part failed: there is no call left to summarize, and
        // pretending otherwise would produce a summary of nothing.
        if (allPartsMissing(parts)) {
          await lifecycle.failCall(identity, payload.callId, "every part failed to process");
          log.error({ call_id: payload.callId }, "all parts missing; call failed");
          return;
        }

        // The gap may have been the last thing the call was waiting for.
        if (partsSettled(parts)) {
          await lifecycle.setCallStatus(identity, payload.callId, "linking");
          await queue.send(Q_LINK_SPEAKERS, {
            callId: payload.callId,
            ownerId: payload.ownerId,
          });
          log.info({ call_id: payload.callId }, "remaining parts settled; queued link_speakers");
        }
        return;
      }

      // A per-call step. There is no partial version of "summarize this call",
      // so the call itself is what failed — visibly, with the reason, and
      // resumable because every part's work is still there.
      await lifecycle.failCall(identity, payload.callId, `${info.errorType}: ${info.reason}`);
      log.error(
        { call_id: payload.callId, queue: queueName, error_type: info.errorType },
        "call failed",
      );
    },
  };
}
