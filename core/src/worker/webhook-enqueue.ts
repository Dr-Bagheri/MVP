/**
 * Fan-out: one call event becomes one delivery row and one queue message per
 * subscribed webhook.
 *
 * ── Why the enqueuer is a member and the dispatcher is an admin ─────────────
 *
 * This runs inside the pipeline, as the call's OWNER. A member cannot read
 * `echo.webhook` at all — not its URL, not its secret — so the discovery goes
 * through `echo.subscribed_webhooks(event)` (db/0026, extended by 0027), which
 * returns only what a member may know: that a subscription exists, who
 * registered it, and whether it can currently be dispatched. Never where it
 * points.
 *
 * The delivery id is generated HERE, client-side, because the enqueue policy
 * lets a member insert a delivery but not read one back — and `RETURNING` is
 * subject to the select policy. Asking the database for the id it just made
 * would fail; making it ourselves costs nothing.
 *
 * ── Saying what is NOT being sent ───────────────────────────────────────────
 *
 * `subscribed_webhooks` returns disabled and undispatchable subscriptions
 * rather than filtering them, deliberately, so the enqueuer can report them.
 * An org that registered three webhooks and receives one deserves to know the
 * other two were skipped and why — a silently shorter fan-out is the M21
 * failure exactly: a forfeit nobody was told about.
 */
import { randomUUID } from "node:crypto";

import type { Identity } from "../agent/types.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";
import { Q_DELIVER_WEBHOOK, type Queue } from "./queue.ts";
import type { StepLogger } from "./runner.ts";

/** The events the WORKER emits. `call.created` belongs to the api. */
export type WorkerWebhookEvent = "call.transcribed" | "call.summarized" | "call.failed";

interface SubscribedRow {
  webhook_id: string;
  events: string[];
  enabled: boolean;
  created_by: string;
  dispatchable: boolean;
}

export interface EnqueueResult {
  subscribed: number;
  queued: number;
  disabled: number;
  undispatchable: number;
}

/**
 * Never throws into the caller's step. A webhook that cannot be queued must not
 * cost a customer their transcript or summary — the pipeline's work is already
 * done and stored by the time this runs (M21: the system forfeits the derived
 * thing, never the record). Failures are logged loudly and the step continues.
 */
export async function enqueueWebhooks(
  db: Db,
  identity: Identity,
  event: WorkerWebhookEvent,
  callId: string,
  queue: Queue,
  log: StepLogger,
): Promise<EnqueueResult> {
  const result: EnqueueResult = { subscribed: 0, queued: 0, disabled: 0, undispatchable: 0 };

  try {
    const subscriptions = await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe<SubscribedRow>(`select * from echo.subscribed_webhooks($1)`, [event]),
    );
    result.subscribed = subscriptions.length;

    for (const subscription of subscriptions) {
      if (!subscription.enabled) {
        result.disabled++;
        continue;
      }
      // The registrar is no longer an active admin, so the dispatcher would
      // queue it, attempt it, and be refused by the wall. Skipping here makes
      // the same decision earlier and visibly, instead of late and silently.
      if (!subscription.dispatchable) {
        result.undispatchable++;
        continue;
      }

      const deliveryId = randomUUID();

      // Identifiers and status ONLY (M17). A transcript never leaves in a
      // webhook body; the consumer fetches through the gateway, under the wall.
      const payload = { event, call_id: callId };

      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.webhook_delivery (id, org_id, webhook_id, event, payload)
           values ($1, $2, $3, $4, ${JSONB_PARAM(5)})`,
          [deliveryId, identity.orgId, subscription.webhook_id, event, toJsonb(payload)],
        ),
      );

      await queue.send(Q_DELIVER_WEBHOOK, {
        deliveryId,
        webhookId: subscription.webhook_id,
        orgId: identity.orgId,
        // The dispatcher runs as the registrar, not as the member who enqueued
        // this — reading the webhook and advancing the delivery both require
        // admin (db/0013, 0026).
        actorId: subscription.created_by,
      });
      result.queued++;
    }

    if (result.subscribed > 0) {
      log.info(
        { call_id: callId, event, ...result },
        result.queued < result.subscribed
          ? "webhooks queued, some skipped"
          : "webhooks queued",
      );
    }
  } catch (error) {
    // Loud, and swallowed. The call is already correct in the database; losing
    // its notification is a forfeit worth reporting, not one worth failing a
    // recording over.
    log.error(
      { call_id: callId, event, err: (error as Error).message },
      "webhook fan-out failed; the call is unaffected",
    );
  }

  return result;
}
