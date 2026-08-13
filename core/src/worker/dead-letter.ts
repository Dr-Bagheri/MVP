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
import { identityForJob } from "../db/actor.ts";
import type { Db } from "../db/identity.ts";
import { allPartsMissing, partsSettled, type Lifecycle } from "./lifecycle.ts";
import {
  isDeliveryPayload,
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
      // A dead-lettered DELIVERY has no call to fail and no part to gap. Its
      // own row already carries `failed_at` and the reason, written by the
      // step before it threw — so the only thing left is to say so. Reaching
      // for `payload.callId` here would fail a call that has nothing to do
      // with a webhook that could not be delivered.
      if (isDeliveryPayload(body)) {
        log.error(
          { queue: queueName, delivery_id: body.deliveryId, webhook_id: body.webhookId,
            org_id: body.orgId, error_type: info.errorType, exhausted: info.exhausted },
          "webhook delivery dead-lettered",
        );
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
