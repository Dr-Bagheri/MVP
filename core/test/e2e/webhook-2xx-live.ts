/**
 * THE 2xx LEG — a real delivery, to a real public receiver, verified.
 *
 * Everything else about the dispatcher is provable without a receiver: the
 * address guard refuses things, and `dispatcher-live.ts` proves it refuses the
 * right things for the right reasons. What no amount of refusing proves is the
 * path a customer actually experiences — `delivered:true`, a signature that
 * validates on the far side, and `webhook_delivery.response_code` recording a
 * success. The guard blocks loopback with no dev escape hatch, so a local
 * receiver is unreachable by construction; the receiver is therefore an Edge
 * Function on our own project (core/supabase/functions/echo-webhook-probe).
 *
 * THE TAMPER CASE IS NOT OPTIONAL. A receiver that answers 200 to everything
 * would make every check below pass against a dispatcher that signed nothing
 * at all. So the run also sends a delivery whose body no longer matches its
 * signature and REQUIRES a 401 — the negative control that gives the positive
 * one meaning.
 *
 *   ECHO_WEBHOOK_PROBE_URL=https://<ref>.functions.supabase.co/echo-webhook-probe \
 *   ECHO_WEBHOOK_PROBE_SECRET=<the digest set as ECHO_WEBHOOK_SECRET_SHA256> \
 *   ECHO_APP_DB_URL=… ECHO_AGENT_DB_URL=… ECHO_PLATFORM_DB_URL=… \
 *   node --experimental-strip-types test/e2e/webhook-2xx-live.ts
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { createDb, type SqlClient, type SqlTx } from "../../src/db/identity.ts";
import { loadWorkerConfig } from "../../src/worker/config.ts";
import { normalizeDbUrl } from "../../src/worker/main.ts";
import { deliver } from "../../src/worker/webhook-delivery.ts";
import { createWebhookStep } from "../../src/worker/webhook-step.ts";
import {
  signDelivery,
  SIGNATURE_HEADER,
  EVENT_HEADER,
  DELIVERY_HEADER,
} from "../../src/worker/webhook-signing.ts";

const checks: [string, boolean, string | undefined][] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return value;
}

const silent = { info: () => {}, warn: () => {}, error: () => {} };

async function main(): Promise<void> {
  const probeUrl = requireEnv("ECHO_WEBHOOK_PROBE_URL");
  const secret = requireEnv("ECHO_WEBHOOK_PROBE_SECRET");

  // ------------------------------------------------------------------
  // [1] The transport, directly. No database yet — if this cannot reach the
  // receiver, nothing below would mean anything and the failure should say so
  // in one line rather than as a confusing DB assertion.
  // ------------------------------------------------------------------
  console.log("\n[1] a genuine signed delivery");
  const body = JSON.stringify({
    event: "call.ready",
    call_id: randomUUID(),
    org_id: randomUUID(),
    status: "ready",
  });
  const at = Math.floor(Date.now() / 1000);

  const good = await deliver({
    url: probeUrl,
    body,
    headers: {
      [SIGNATURE_HEADER]: signDelivery(secret, body, at),
      [EVENT_HEADER]: "call.ready",
      [DELIVERY_HEADER]: randomUUID(),
    },
  });
  check(
    "a genuine delivery is accepted by the receiver",
    good.delivered && good.status === 200,
    `HTTP ${good.status} · ${good.reason}`,
  );

  // ------------------------------------------------------------------
  // [2] The negative control. Same signature, one byte of body changed.
  // ------------------------------------------------------------------
  console.log("[2] a TAMPERED delivery");
  const tampered = body.replace('"ready"', '"failed"');
  const bad = await deliver({
    url: probeUrl,
    body: tampered,
    headers: {
      [SIGNATURE_HEADER]: signDelivery(secret, body, at), // signed for the ORIGINAL body
      [EVENT_HEADER]: "call.ready",
      [DELIVERY_HEADER]: randomUUID(),
    },
  });
  check(
    "a tampered body is REFUSED (401), so the 200 above means something",
    !bad.delivered && bad.status === 401,
    `HTTP ${bad.status} · ${bad.reason}`,
  );
  check(
    "and a 401 is treated as permanent, not retried",
    !bad.retryable,
    `retryable=${bad.retryable}`,
  );

  // ------------------------------------------------------------------
  // [3] A replay outside the window. The signature is genuine; only the age is
  // wrong — which is the case a body-only signature would have accepted
  // forever, and the reason the timestamp is inside the MAC.
  // ------------------------------------------------------------------
  console.log("[3] a REPLAYED delivery, correctly signed but stale");
  const stale = await deliver({
    url: probeUrl,
    body,
    headers: {
      [SIGNATURE_HEADER]: signDelivery(secret, body, at - 3600),
      [EVENT_HEADER]: "call.ready",
      [DELIVERY_HEADER]: randomUUID(),
    },
  });
  check(
    "a stale but validly-signed replay is refused",
    !stale.delivered && stale.status === 401,
    `HTTP ${stale.status}`,
  );

  // ------------------------------------------------------------------
  // [4] Through the STEP, against the real database — the part that proves
  // `response_code` and `delivered_at` are actually written. The transport
  // being right says nothing about the row.
  // ------------------------------------------------------------------
  console.log("[4] the real step, writing the real row");
  const sql = postgres(normalizeDbUrl(requireEnv("ECHO_APP_DB_URL")), { max: 4, ssl: { rejectUnauthorized: false } });
  const agentSql = postgres(normalizeDbUrl(requireEnv("ECHO_AGENT_DB_URL")), { max: 2, ssl: { rejectUnauthorized: false } });
  const ownerSql = postgres(normalizeDbUrl(requireEnv("ECHO_PLATFORM_DB_URL")), { max: 1, ssl: { rejectUnauthorized: false } });
  const db = createDb({ app: sql as unknown as SqlClient, agent: agentSql as unknown as SqlClient });

  const orgId = randomUUID();
  const adminId = randomUUID();
  let webhookId = "";
  let deliveryId = "";

  try {
    const email = `wh-${adminId}@example.invalid`;
    await ownerSql`insert into echo.org (id, name, status) values (${orgId}, ${`webhook 2xx ${orgId.slice(0, 8)}`}, 'active')`;
    await ownerSql`insert into auth.users (id, email) values (${adminId}, ${email})`;
    await ownerSql`
      insert into echo.app_user (id, org_id, email, display_name, role, status, accepted_at)
      values (${adminId}, ${orgId}, ${email}, 'webhook admin', 'admin', 'active', now())`;

    const identity = { userId: adminId, orgId, role: "admin" as const, isActive: true };

    webhookId = (
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.webhook (org_id, url, secret_sha256, events, enabled, created_by)
           values ($1, $2, $3, array['call.ready'], true, $4) returning id`,
          [orgId, probeUrl, secret, adminId],
        ),
      )
    )[0]!.id;

    deliveryId = (
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.webhook_delivery (org_id, webhook_id, event, payload)
           values ($1, $2, 'call.ready', $3::text::jsonb) returning id`,
          [orgId, webhookId, JSON.stringify({ event: "call.ready", status: "ready" })],
        ),
      )
    )[0]!.id;

    const step = createWebhookStep({ db, config: loadWorkerConfig() });
    await step.handle(
      { deliveryId, webhookId, actorId: adminId } as never,
      { attempt: 1, log: silent as never },
    );

    const row = (
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ response_code: number | null; delivered_at: string | null; failed_at: string | null; attempts: number }>(
          `select response_code, delivered_at, failed_at, attempts
             from echo.webhook_delivery where id = $1`,
          [deliveryId],
        ),
      )
    )[0]!;

    check("the step recorded response_code 200", row.response_code === 200, String(row.response_code));
    check("delivered_at was stamped", row.delivered_at !== null);
    check("failed_at was NOT stamped", row.failed_at === null);
    check("attempts was recorded", row.attempts >= 1, String(row.attempts));

    // Idempotency: a redelivered queue message must not hit the customer's
    // endpoint twice for one event.
    await step.handle(
      { deliveryId, webhookId, actorId: adminId } as never,
      { attempt: 2, log: silent as never },
    );
    const again = (
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ attempts: number }>(`select attempts from echo.webhook_delivery where id = $1`, [deliveryId]),
      )
    )[0]!;
    check("a settled delivery is not sent again", again.attempts === row.attempts, `attempts still ${again.attempts}`);
  } finally {
    if (deliveryId) await ownerSql`delete from echo.webhook_delivery where id = ${deliveryId}`;
    if (webhookId) await ownerSql`delete from echo.webhook where id = ${webhookId}`;
    await ownerSql`delete from echo.app_user where id = ${adminId}`;
    await ownerSql`delete from auth.users    where id = ${adminId}`;
    await ownerSql`delete from echo.org      where id = ${orgId}`;
    await sql.end();
    await agentSql.end();
    await ownerSql.end();
  }

  console.log("\n─── checks ───");
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`\n${failed === 0 ? "WEBHOOK 2xx ACCEPTANCE PASSED" : `WEBHOOK 2xx ACCEPTANCE FAILED (${failed})`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nharness failed:", (error as Error).message);
  process.exit(1);
});
