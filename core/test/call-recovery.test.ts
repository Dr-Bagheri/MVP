import { describe, expect, it, vi } from "vitest";

import {
  NOTHING_RECORDED,
  planResume,
  sweepStalledCalls,
  type StalledCall,
} from "../src/worker/call-recovery.ts";
import type { Db, SqlTx } from "../src/db/identity.ts";
import type { Lifecycle } from "../src/worker/lifecycle.ts";
import type { Queue } from "../src/worker/queue.ts";

/**
 * The stall recovery (db/0235; user report 2026-09-19, "this one stayed in
 * processing").
 *
 * What is provable here is the DECISION and the ORDER of what follows it.
 * What is not, and is not claimed: that `stalled_calls` picks the right rows —
 * that is SQL against pgmq and real timestamps, and it lives in db/test/136.
 * The fake here answers the door, it does not implement it, which is the
 * difference between testing this file and testing a belief about the door.
 */

const CALL = "c0000000-0000-4000-8000-00000000000c";
const OWNER = "01000000-0000-4000-8000-000000000001";
const ORG = "0a000000-0000-4000-8000-00000000000a";

describe("planResume — where a call re-enters, read from the artifacts", () => {
  it("no usable part is NOTHING, never a summary of an empty transcript", () => {
    expect(planResume({ usableParts: 0, bareParts: 0, hasSummary: false })).toBe("nothing");
  });

  /*
   * THE ORDER IS THE TEST. A call with no parts also has no BARE parts and no
   * summary, so a version that asked those questions first would answer
   * "summary" here — and the pipeline would produce a record of a meeting
   * nobody recorded. This case is the one that catches that version.
   */
  it("a call written off entirely (every part a gap) is nothing, not a summary", () => {
    expect(planResume({ usableParts: 0, bareParts: 0, hasSummary: true })).toBe("nothing");
  });

  it("a part with no transcript re-runs the parts", () => {
    expect(planResume({ usableParts: 3, bareParts: 1, hasSummary: false })).toBe("parts");
  });

  it("parts come before the summary even when one already exists", () => {
    expect(planResume({ usableParts: 3, bareParts: 1, hasSummary: true })).toBe("parts");
  });

  it("every transcript present and no summary → re-enter at link_speakers", () => {
    expect(planResume({ usableParts: 2, bareParts: 0, hasSummary: false })).toBe("summary");
  });

  it("every artifact present → only the status write was lost", () => {
    expect(planResume({ usableParts: 2, bareParts: 0, hasSummary: true })).toBe("ready");
  });
});

interface Recorded { sql: string; params: unknown[] }

function harness(stalled: StalledCall[], opts: {
  claim?: boolean;
  bareIds?: string[];
} = {}) {
  const calls: Recorded[] = [];
  const answer = (sql: string): unknown[] => {
    if (sql.includes("echo.stalled_calls")) return stalled;
    if (sql.includes("claim_call_recovery")) return [{ ok: opts.claim !== false }];
    if (sql.includes("from echo.call_part")) {
      return (opts.bareIds ?? []).map((id) => ({ id }));
    }
    return [];
  };
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve(answer(sql));
    },
  } as unknown as SqlTx;
  const db = {
    withIdentity: (_who: unknown, fn: (tx: SqlTx) => unknown) => fn(tx),
    withoutIdentity: (fn: (tx: SqlTx) => unknown) => fn(tx),
  } as unknown as Db;

  const sent: { queue: string; body: unknown }[] = [];
  const queue = {
    send: (queue: string, body: unknown) => {
      sent.push({ queue, body });
      return Promise.resolve(1);
    },
  } as unknown as Queue;

  const lifecycle = {
    failCall: vi.fn(() => Promise.resolve()),
    setCallStatus: vi.fn(() => Promise.resolve()),
  } as unknown as Lifecycle;

  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  const log = {
    info: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }),
    warn: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }),
    error: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }),
  };
  return { db, queue, lifecycle, calls, sent, lines, log };
}

function row(over: Partial<StalledCall> = {}): StalledCall {
  return {
    call_id: CALL, owner_id: OWNER, org_id: ORG, status: "processing",
    usable_parts: 1, bare_parts: 0, has_summary: false, ...over,
  };
}

/* resolveIdentity reads the database for the owner; the recovery must run as
   them, and the fake above answers every read, so it resolves to a member. */
vi.mock("../src/db/actor.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/actor.ts")>();
  return {
    ...actual,
    resolveIdentity: vi.fn((_db: unknown, userId: string) =>
      Promise.resolve({ userId, orgId: ORG, role: "member", isActive: true })),
  };
});

describe("sweepStalledCalls", () => {
  /* the capability probe reads information_schema through the same fake; the
     empty answer would report the column absent, so it is stubbed present */
  vi.mock("../src/db/capabilities.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/db/capabilities.ts")>();
    return { ...actual, hasCallRecovery: () => Promise.resolve(true) };
  });

  it("a call with no audio is FAILED with the one shared reason, and nothing is enqueued", async () => {
    const h = harness([row({ usable_parts: 0 })]);
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.lifecycle.failCall).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER }), CALL, NOTHING_RECORDED);
    expect(h.sent).toHaveLength(0);
  });

  it("bare parts are re-enqueued one job each, AS THE CALL'S OWNER", async () => {
    const h = harness([row({ usable_parts: 2, bare_parts: 2 })], { bareIds: ["p1", "p2"] });
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.sent).toEqual([
      { queue: "echo_process_part", body: { callId: CALL, ownerId: OWNER, partId: "p1" } },
      { queue: "echo_process_part", body: { callId: CALL, ownerId: OWNER, partId: "p2" } },
    ]);
    expect(h.lifecycle.failCall).not.toHaveBeenCalled();
  });

  it("a complete transcript re-enters at link_speakers", async () => {
    const h = harness([row({ usable_parts: 2, bare_parts: 0 })]);
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.sent).toEqual([
      { queue: "echo_link_speakers", body: { callId: CALL, ownerId: OWNER } },
    ]);
  });

  it("every artifact present → marked ready, and no model call is bought", async () => {
    const h = harness([row({ usable_parts: 1, bare_parts: 0, has_summary: true })]);
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.lifecycle.setCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER }), CALL, "ready");
    expect(h.sent).toHaveLength(0);
  });

  /*
   * THE CLAIM IS THE WALL. Two workers read the same list in the same second;
   * the one that loses the compare-and-set must do NOTHING — otherwise one
   * call's parts are enqueued twice and the org pays the provider twice.
   */
  it("losing the claim does nothing at all — no write, no enqueue", async () => {
    const h = harness([row({ usable_parts: 2, bare_parts: 2 })], { claim: false, bareIds: ["p1"] });
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.sent).toHaveLength(0);
    expect(h.lifecycle.failCall).not.toHaveBeenCalled();
    expect(h.lifecycle.setCallStatus).not.toHaveBeenCalled();
  });

  it("claims BEFORE it acts — the other order lets both workers through", async () => {
    const h = harness([row({ usable_parts: 2, bare_parts: 1 })], { bareIds: ["p1"] });
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    const claimAt = h.calls.findIndex((c) => c.sql.includes("claim_call_recovery"));
    const readAt = h.calls.findIndex((c) => c.sql.includes("from echo.call_part"));
    expect(claimAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(claimAt);
  });

  it("every call it touches leaves a line naming the call and the decision", async () => {
    const h = harness([row({ usable_parts: 0 })]);
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    const line = h.lines.find((l) => l.fields.event === "stalled_call_recovered");
    expect(line?.fields).toMatchObject({ call_id: CALL, was: "processing", resumed_at: "nothing" });
  });

  it("an empty list is a quiet pass — no claim, no log, nothing", async () => {
    const h = harness([]);
    await sweepStalledCalls({ db: h.db, queue: h.queue, lifecycle: h.lifecycle }, h.log);
    expect(h.calls.filter((c) => c.sql.includes("claim_call_recovery"))).toHaveLength(0);
    expect(h.lines).toHaveLength(0);
  });

  it("the floor and the cooldown are ONE number, passed to both the read and the claim", async () => {
    const h = harness([row()]);
    await sweepStalledCalls(
      { db: h.db, queue: h.queue, lifecycle: h.lifecycle, minutes: 42 }, h.log);
    const read = h.calls.find((c) => c.sql.includes("echo.stalled_calls"));
    const claim = h.calls.find((c) => c.sql.includes("claim_call_recovery"));
    expect(read?.params).toContain(42);
    expect(claim?.params).toContain(42);
  });
});
