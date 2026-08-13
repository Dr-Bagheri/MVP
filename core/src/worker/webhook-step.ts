/**
 * The dispatcher step: one queued delivery, attempted once, recorded.
 *
 * ── Who it runs as ─────────────────────────────────────────────────────────
 *
 * The webhook's `created_by` — an admin by construction, since db/0013's
 * `webhook_admin` required admin at creation, and both `echo.webhook` and
 * `webhook_delivery`'s read policy demand admin. Ratified into M17 for a
 * reason worth keeping visible: it matches D6's posture for inbound keys,
 * where "disabling an employee stops their integrations immediately" is a
 * FEATURE. Outbound behaves the same way.
 *
 * The consequence, stated rather than discovered: demote or disable that
 * admin and their org's deliveries stop. Fail-closed, visible in the delivery
 * reason, and recoverable by re-creating the webhook as a current admin.
 *
 * The identity still arrives in the PAYLOAD and is re-read fail-closed, exactly
 * as pipeline jobs carry their owner. No service account, no privileged lookup
 * "just to find out who registered this".
 */
import { resolveIdentity } from "../db/actor.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { backoffSeconds, type WorkerConfig } from "./config.ts";
import { deliver as defaultDeliver, type DeliveryOutcome } from "./webhook-delivery.ts";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signDelivery,
} from "./webhook-signing.ts";
import { isDeliveryPayload, Q_DELIVER_WEBHOOK, type QueuePayload } from "./queue.ts";
import { StepError, type StepHandler } from "./runner.ts";



interface DeliveryRow {
  id: string;
  event: string;
  payload: unknown;
  attempts: number;
  delivered_at: string | null;
  failed_at: string | null;
}

interface WebhookRow {
  url: string;
  secret_sha256: string;
  enabled: boolean;
  events: string[];
}

export interface WebhookStepOptions {
  db: Db;
  config: WorkerConfig;
  /** Injected so tests exercise the step without a network. */
  deliver?: typeof defaultDeliver;
  nowSeconds?: () => number;
}

export function createWebhookStep({
  db,
  config,
  deliver = defaultDeliver,
  nowSeconds = () => Math.floor(Date.now() / 1000),
}: WebhookStepOptions): StepHandler {
  return {
    name: "deliver_webhook",
    queue: Q_DELIVER_WEBHOOK,

    async handle(body: QueuePayload, { log }) {
      if (!isDeliveryPayload(body)) {
        throw new StepError("bad_payload", "delivery job carries no deliveryId", false);
      }

      const identity = await resolveDeliveryIdentity(db, body.actorId);

      const [delivery, webhook] = await db.withIdentity(identity, async (tx: SqlTx) => [
        (
          await tx.unsafe<DeliveryRow>(
            `select id, event, payload, attempts, delivered_at, failed_at
               from echo.webhook_delivery where id = $1 limit 1`,
            [body.deliveryId],
          )
        )[0],
        (
          await tx.unsafe<WebhookRow>(
            `select url, secret_sha256, enabled, events from echo.webhook where id = $1 limit 1`,
            [body.webhookId],
          )
        )[0],
      ]);

      // Fail closed. Invisible to the admin who registered it means either the
      // payload is stale/forged, or that admin is no longer an admin — the
      // designed consequence, and the reason names it rather than reporting a
      // generic miss.
      if (!delivery || !webhook) {
        throw new StepError(
          "delivery_not_visible",
          "the webhook or delivery is not visible to the actor it was queued for — the registering admin may have been demoted",
          true,
        );
      }

      // Idempotency against the artifact, not the queue: a redelivered message
      // must not send a customer's endpoint the same event twice.
      if (delivery.delivered_at || delivery.failed_at) {
        log.info({ delivery_id: delivery.id }, "delivery already settled; nothing to do");
        return;
      }

      if (!webhook.enabled) {
        await settle(db, identity, delivery.id, { status: null, reason: "webhook_disabled", delivered: false, retryable: false }, config, log);
        return;
      }

      const bodyText = JSON.stringify(delivery.payload ?? {});
      const outcome = await deliver({
        url: webhook.url,
        body: bodyText,
        headers: {
          [SIGNATURE_HEADER]: signDelivery(webhook.secret_sha256, bodyText, nowSeconds()),
          [EVENT_HEADER]: delivery.event,
          [DELIVERY_HEADER]: delivery.id,
        },
      });

      await settle(db, identity, delivery.id, outcome, config, log, delivery.attempts + 1);
    },
  };
}

/**
 * Resolve the admin this delivery runs as.
 *
 * Deliberately NOT `identityForJob` — that re-reads a CALL, and a delivery has
 * none. The fail-closed check here is the read of the webhook itself, above:
 * if this actor cannot see it, nothing proceeds.
 */
async function resolveDeliveryIdentity(db: Db, actorId: string): Promise<Identity> {
  const identity = await resolveIdentity(db, actorId);
  if (!identity.isActive) {
    throw new StepError(
      "owner_inactive",
      `the webhook's registering admin is ${identity.inactiveReason ?? "inactive"} — requeue once reinstated`,
      true,
    );
  }
  return identity;
}

/**
 * Write the outcome. Three terminal shapes and no others: delivered, retry
 * later, or failed for good — mirroring the runner's own disposition, because
 * a delivery that quietly stops being either pending or finished is a delivery
 * nobody can explain.
 */
async function settle(
  db: Db,
  identity: Identity,
  deliveryId: string,
  outcome: DeliveryOutcome,
  config: WorkerConfig,
  log: { info: (f: Record<string, unknown>, m: string) => void; warn: (f: Record<string, unknown>, m: string) => void },
  attempt = 1,
): Promise<void> {
  const exhausted = attempt >= config.maxAttempts;
  const retrying = outcome.retryable && !exhausted;

  await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe(
      `update echo.webhook_delivery
          set attempts        = $2,
              response_code   = $3,
              delivered_at    = case when $4 then now() else delivered_at end,
              failed_at       = case when $5 then now() else failed_at end,
              next_attempt_at = $6
        where id = $1`,
      [
        deliveryId,
        attempt,
        outcome.status,
        outcome.delivered,
        !outcome.delivered && !retrying,
        retrying ? new Date(Date.now() + backoffSeconds(attempt, config) * 1000).toISOString() : null,
      ],
    ),
  );

  const fields = { delivery_id: deliveryId, status: outcome.status, reason: outcome.reason, attempt };
  if (outcome.delivered) log.info(fields, "webhook delivered");
  else if (retrying) log.warn(fields, "webhook delivery failed; retrying");
  // A blocked address is the one that must never look routine in a log: it
  // means someone pointed our deployment at an address it refused to reach.
  else log.warn(fields, "webhook delivery failed permanently");
}
