/**
 * The outbound half of the gateway (M17): webhooks.
 *
 * The rule that shapes everything here is db/0009's comment on
 * `webhook_delivery.payload`: **identifiers and status only**. No transcript
 * text, no summary body, no title, no speaker names. A webhook is a doorbell,
 * not a delivery — the consumer is told *that* something happened and comes
 * back through the gateway to read it, where the same wall applies and the
 * same audit trail records the read.
 *
 * That is not caution for its own sake. A webhook body goes to a URL the org
 * configured, over a channel we do not control, and is retried into logs and
 * queues we cannot see. Everything else in this product treats transcript
 * text as the most sensitive thing it holds; a webhook that carried it would
 * be the one door that quietly didn't.
 */
import { createHmac, randomBytes } from "node:crypto";

import { safeEqual } from "./apikeys.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import { assertDeliverableUrl, BlockedAddressError } from "../net/address-guard.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/**
 * The events a webhook may subscribe to. A closed set, because an org that
 * subscribes to a typo would silently receive nothing forever and reasonably
 * conclude the feature is broken. Defined in vocabulary.ts with the other
 * published vocabularies; re-exported here for existing importers.
 */
export { WEBHOOK_EVENTS, type WebhookEvent } from "./vocabulary.ts";
import { WEBHOOK_EVENTS as EVENTS, type WebhookEvent } from "./vocabulary.ts";

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  /** Whose authority deliveries run as — the id; the UI joins members. */
  created_by: string;
  created_at: string;
}

export interface MintedWebhook extends WebhookRecord {
  /** Shown once, like an api key. Used by the consumer to verify signatures. */
  secret: string;
}

const SIGNATURE_VERSION = "v1";

/**
 * `v1=<hex hmac>` over `<timestamp>.<body>`.
 *
 * The timestamp is inside the signed string, not merely beside it: signing
 * the body alone yields a signature that stays valid forever, so a captured
 * delivery can be replayed at any time. The consumer checks freshness AND the
 * signature, which only works if tampering with the timestamp breaks the
 * signature.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `${SIGNATURE_VERSION}=${mac}`;
}

/**
 * The verification an integrator should perform, exported so our docs can
 * point at real code and so our own tests verify what we tell people to do.
 * Constant-time compare via the same helper the api uses.
 */
export function verifySignature(
  secret: string, body: string, timestamp: number, signature: string,
  toleranceSec = 300,
): boolean {
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (!Number.isFinite(timestamp) || age > toleranceSec) return false;
  return safeEqual(signPayload(secret, body, timestamp), signature);
}

/**
 * What may appear in a delivery body. Compare with db/0009: this type IS the
 * "identifiers and status only" rule, expressed where TypeScript can hold it.
 * Adding `title` or `text` here should feel like the deliberate act it is.
 */
export interface WebhookPayload {
  event: WebhookEvent;
  call_id: string;
  org_id: string;
  occurred_at: string;
  status?: string | undefined;
}

/**
 * `created_by` is on the wire because M17 promises the admin UI shows whose
 * authority a webhook runs as, and the frontend went to build that and found
 * the wire structurally could not carry it — they refused to fake it.
 *
 * It matters operationally, not cosmetically: db/0029 pins a delivery to the
 * REGISTERING actor, so demoting an admin stops their org's deliveries. With
 * no creator on the wire, nothing on screen says which ones died or why.
 */
const WEBHOOK_COLUMNS = `id, url, events, enabled, created_by, created_at`;

const toRecord = (row: Record<string, unknown>): WebhookRecord => ({
  id: row.id as string,
  url: row.url as string,
  events: (row.events as string[]) ?? [],
  enabled: Boolean(row.enabled),
  created_by: row.created_by as string,
  created_at: iso(row.created_at),
});

export function createWebhooksRepo(db: Db) {
  return {
    /** Admin-only by RLS (db/0013 `webhook_admin`) — not re-checked here. */
    async create(
      identity: Identity, input: { url: string; events: string[] },
    ): Promise<MintedWebhook> {
      const url = (input.url ?? "").trim();
      // The schema enforces https too (db/0009). Checked here as well so the
      // caller gets a legible 400 instead of a constraint violation, not
      // because the app layer is the authority on it.
      //
      // And the address guard (steward finding): a webhook URL is fetched by
      // US from inside the deployment network, and `webhook_delivery
      // .response_code` is admin-readable — so an unguarded delivery is a
      // port-scan oracle for the internal network, not merely an outbound
      // request. This refuses a literal private address at the moment the
      // admin can fix it; the CONTROL is `guardedLookup` at connect time,
      // because DNS rebinding walks straight past any parse-time check.
      try {
        assertDeliverableUrl(url);
      } catch (error) {
        if (error instanceof BlockedAddressError) throw new ValidationError(error.message);
        throw error;
      }
      const events = input.events ?? [];
      if (!Array.isArray(events) || events.length === 0) {
        throw new ValidationError("at least one event is required");
      }
      const unknown = events.filter((e) => !(EVENTS as readonly string[]).includes(e));
      if (unknown.length > 0) {
        // Named, because "unknown event" without saying which one is how an
        // integrator ends up subscribing to nothing and blaming the product.
        throw new ValidationError(`unknown events: ${unknown.join(", ")}`);
      }

      const secret = `whsec_${randomBytes(32).toString("base64url")}`;
      const secretSha256 = createHmac("sha256", secret).update("echo-webhook").digest("hex");

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `insert into echo.webhook (org_id, url, secret_sha256, events, created_by)
           values ($1, $2, $3, $4::text[], $5)
           returning ${WEBHOOK_COLUMNS}`,
          [identity.orgId, url, secretSha256, events, identity.userId],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("could not create webhook");
      return { ...toRecord(row), secret };
    },

    async list(identity: Identity): Promise<WebhookRecord[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${WEBHOOK_COLUMNS} from echo.webhook order by created_at desc`,
        ),
      );
      return rows.map(toRecord);
    },

    /**
     * Disable rather than delete — `echo_app` holds no DELETE grant, and a
     * disabled webhook keeps its delivery history readable, which is what an
     * org needs when asking why something did or didn't arrive.
     */
    async setEnabled(identity: Identity, webhookId: string, enabled: boolean): Promise<WebhookRecord> {
      const id = assertUuid(webhookId, "webhook id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `update echo.webhook set enabled = $2 where id = $1 returning ${WEBHOOK_COLUMNS}`,
          [id, enabled],
        ),
      );
      const row = rows[0];
      if (!row) throw new NotFoundError("webhook not found");
      return toRecord(row);
    },

    /**
     * Delivery history: status and timing, never a body. `payload` is not
     * selected — it holds only identifiers by construction, but a listing
     * endpoint that returns it invites someone to start putting more in it.
     */
    async deliveries(
      identity: Identity, options: { webhookId?: string | undefined; limit?: number | undefined } = {},
    ): Promise<Record<string, unknown>[]> {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const webhookId = options.webhookId ? assertUuid(options.webhookId, "webhook id") : null;
      return db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select id, webhook_id, event, attempts, response_code,
                  delivered_at, failed_at, next_attempt_at, created_at
             from echo.webhook_delivery
            where ($1::uuid is null or webhook_id = $1::uuid)
            order by created_at desc
            limit $2`,
          [webhookId, limit],
        ),
      );
    },
  };
}

export type WebhooksRepo = ReturnType<typeof createWebhooksRepo>;
