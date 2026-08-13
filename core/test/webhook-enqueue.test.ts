/**
 * Fan-out: one call event → one delivery row and one queue message per
 * subscribed webhook.
 *
 * The assertions that carry weight are about IDENTITY (the delivery must run
 * as the registrar, not the member who enqueued it), about what is NOT sent
 * (M17: identifiers and status only), and about what is SAID when a
 * subscription is skipped.
 */
import { describe, expect, it, vi } from "vitest";

import { enqueueWebhooks } from "../src/worker/webhook-enqueue.ts";
import { Q_DELIVER_WEBHOOK, type Queue } from "../src/worker/queue.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const MEMBER = { userId: "11111111-1111-4111-8111-111111111111", orgId: "org-1", role: "member" as const, isActive: true };
const ADMIN_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ADMIN_B = "bbbbbbbb-1111-4111-8111-111111111111";
const CALL = "22222222-2222-4222-8222-222222222222";

const subscription = (over: Partial<Record<string, unknown>> = {}) => ({
  webhook_id: `wh-${Math.random().toString(36).slice(2, 8)}`,
  events: ["call.summarized"],
  enabled: true,
  created_by: ADMIN_A,
  dispatchable: true,
  ...over,
});

function harness(subscriptions: unknown[], opts: { insertFails?: boolean } = {}) {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const tx = {
    unsafe: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("subscribed_webhooks")) return subscriptions;
      if (sql.includes("insert into echo.webhook_delivery")) {
        if (opts.insertFails) throw new Error("insert denied");
        inserts.push({ sql, params });
      }
      return [];
    },
  };
  const db = {
    withActor: async (_a: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    withIdentity: async (_i: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    withoutIdentity: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as never;

  const sent: { queue: string; body: Record<string, string> }[] = [];
  const queue = {
    send: vi.fn(async (q: string, body: Record<string, string>) => {
      sent.push({ queue: q, body });
      return 1;
    }),
  } as unknown as Queue;

  return { db, queue, sent, inserts };
}

describe("fan-out", () => {
  it("queues one delivery per subscribed webhook", async () => {
    const { db, queue, sent } = harness([subscription(), subscription()]);
    const result = await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    expect(result).toMatchObject({ subscribed: 2, queued: 2, disabled: 0, undispatchable: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.queue).toBe(Q_DELIVER_WEBHOOK);
  });

  it("addresses the delivery to the REGISTRAR, not the member who enqueued it", async () => {
    // The single most important assertion here. Dispatch requires admin, the
    // enqueuer is a member, and attributing an outbound call to whoever
    // happened to own the recording would put a name in the audit trail that
    // never agreed to it.
    const { db, queue, sent } = harness([subscription({ created_by: ADMIN_B })]);
    await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    expect(sent[0]!.body.actorId).toBe(ADMIN_B);
    expect(sent[0]!.body.actorId).not.toBe(MEMBER.userId);
  });

  it("generates the delivery id itself", async () => {
    // The enqueue policy lets a member INSERT a delivery but not read one
    // back, and RETURNING is subject to the select policy — so asking the
    // database for the id it just made would fail.
    const { db, queue, sent, inserts } = harness([subscription()]);
    await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    expect(inserts[0]!.sql).not.toMatch(/returning/i);
    expect(sent[0]!.body.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    // The id in the message is the id in the row: a message naming a delivery
    // that does not exist is a dispatcher that fails forever.
    expect(inserts[0]!.params[0]).toBe(sent[0]!.body.deliveryId);
  });

  it("sends identifiers and status ONLY — never content", async () => {
    // M17. A transcript never leaves in a webhook body; the consumer fetches
    // through the gateway, under the wall.
    const { db, queue, inserts } = harness([subscription()]);
    await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    const payload = JSON.parse(inserts[0]!.params[4] as string);
    expect(payload).toEqual({ event: "call.summarized", call_id: CALL });
    expect(Object.keys(payload)).not.toContain("text");
    expect(Object.keys(payload)).not.toContain("body");
  });
});

describe("subscriptions that are skipped are COUNTED, not hidden", () => {
  it("reports a disabled subscription rather than silently sending less", async () => {
    // subscribed_webhooks returns disabled rows deliberately so the enqueuer
    // can say so. An org that registered three and receives one deserves to
    // know why (M21: forfeits are said out loud).
    const { db, queue, sent } = harness([
      subscription(),
      subscription({ enabled: false }),
      subscription({ enabled: false }),
    ]);
    const result = await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    expect(result).toMatchObject({ subscribed: 3, queued: 1, disabled: 2 });
    expect(sent).toHaveLength(1);
  });

  it("skips a subscription whose registrar can no longer dispatch", async () => {
    // Same decision the wall would make, taken earlier and visibly: queueing
    // it would mean attempt, refusal, and a dead letter to explain later.
    const { db, queue, sent } = harness([subscription({ dispatchable: false })]);
    const result = await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, silent);

    expect(result).toMatchObject({ subscribed: 1, queued: 0, undispatchable: 1 });
    expect(sent).toHaveLength(0);
  });
});

describe("a failed fan-out never costs the call", () => {
  it("swallows an insert failure and reports zero queued", async () => {
    // The transcript and summary are already stored by the time this runs.
    // Failing the step here would cost a customer their recording over a
    // notification (M21).
    const { db, queue } = harness([subscription()], { insertFails: true });
    const errors: string[] = [];
    const log = { ...silent, error: (_f: Record<string, unknown>, m: string) => errors.push(m) };

    const result = await enqueueWebhooks(db, MEMBER, "call.summarized", CALL, queue, log);

    expect(result.queued).toBe(0);
    // Swallowed, but never silent.
    expect(errors.join()).toMatch(/fan-out failed/);
  });

  it("does nothing at all when no webhook subscribes", async () => {
    const { db, queue, sent } = harness([]);
    const result = await enqueueWebhooks(db, MEMBER, "call.transcribed", CALL, queue, silent);

    expect(result).toMatchObject({ subscribed: 0, queued: 0 });
    expect(sent).toHaveLength(0);
  });
});
