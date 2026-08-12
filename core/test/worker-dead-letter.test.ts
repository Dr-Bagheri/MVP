/**
 * What a dead letter costs the customer.
 *
 * The rule under test (M7, and the Echo Mobile lesson behind it): a part that
 * cannot be recovered becomes a visible gap; the call survives. Losing a
 * 30-minute meeting because minute 12 failed is the worst outcome available.
 */
import { describe, expect, it, vi } from "vitest";

import { createDeadLetterSink } from "../src/worker/dead-letter.ts";
import { Q_SUMMARIZE, Q_PROCESS_PART, type JobPayload, type Queue } from "../src/worker/queue.ts";
import type { Lifecycle, PartRow } from "../src/worker/lifecycle.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

// Real UUIDs: identityForJob runs assertUuid on the call id before it will
// touch anything, so placeholder strings are rejected by the guard rather than
// by the logic under test.
const OWNER = "11111111-1111-4111-8111-111111111111";
const CALL = "22222222-2222-4222-8222-222222222222";
const PART_1 = "33333333-3333-4333-8333-333333333333";
const PART_2 = "44444444-4444-4444-8444-444444444444";

const payload: JobPayload = { callId: CALL, ownerId: OWNER, partId: PART_2 };

const part = (over: Partial<PartRow>): PartRow => ({
  id: PART_1,
  call_id: CALL,
  idx: 0,
  offset_ms: 0,
  duration_ms: 1000,
  storage_bucket: "call-audio",
  storage_path: "a.webm",
  audio_sha256: null,
  status: "diarized",
  missing: false,
  ...over,
});

function harness(parts: PartRow[]) {
  const lifecycle = {
    getPart: vi.fn(),
    partsOfCall: vi.fn(async () => parts),
    setPartStatus: vi.fn(),
    setCallStatus: vi.fn(),
    markPartMissing: vi.fn(),
    noteSummarySkipped: vi.fn(),
    failCall: vi.fn(),
    bumpAttempts: vi.fn(),
  } satisfies Lifecycle as unknown as Lifecycle & Record<string, ReturnType<typeof vi.fn>>;

  const sent: unknown[] = [];
  const queue = {
    send: async (_q: unknown, body: unknown) => { sent.push(body); return 1; },
  } as unknown as Queue;

  // identityForJob is exercised in its own suite; here the db is stubbed to
  // return a usable identity so the sink's DECISIONS are what is under test.
  const db = {
    withActor: async (_a: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ unsafe: async () => [{ id: OWNER, org_id: "55555555-5555-4555-8555-555555555555", role: "member", status: "active", org_status: "active" }] }),
    withIdentity: async (_i: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ unsafe: async () => [{ id: CALL }] }),
    withoutIdentity: async () => [],
  } as never;

  return { lifecycle, queue, sent, db, sink: createDeadLetterSink({ db, lifecycle, queue, log: silent }) };
}

describe("a dead-lettered PART", () => {
  it("becomes a visible gap and does NOT fail the call", async () => {
    const parts = [part({ id: PART_1 }), part({ id: PART_2, status: "pending" })];
    const { sink, lifecycle } = harness(parts);

    await sink.onDeadLetter(Q_PROCESS_PART, payload, {
      errorType: "stt_failed",
      reason: "lane exhausted",
      exhausted: true,
    });

    expect(lifecycle.markPartMissing).toHaveBeenCalledWith(
      expect.anything(),
      PART_2,
      expect.stringContaining("stt_failed"),
    );
    expect(lifecycle.failCall).not.toHaveBeenCalled();
  });

  it("releases the call when the gap was the last thing it waited for", async () => {
    // part-2 is the one that just died; part-1 is already done.
    const parts = [part({ id: PART_1, status: "diarized" }), part({ id: PART_2, missing: true })];
    const { sink, lifecycle, sent } = harness(parts);

    await sink.onDeadLetter(Q_PROCESS_PART, payload, { errorType: "x", reason: "y", exhausted: true });

    // Waiting forever for a part that will never arrive is worse than a gap,
    // because nobody can see it happening.
    expect(lifecycle.setCallStatus).toHaveBeenCalledWith(expect.anything(), CALL, "linking");
    expect(sent).toHaveLength(1);
  });

  it("fails the call only when EVERY part is missing", async () => {
    const parts = [part({ id: PART_1, missing: true }), part({ id: PART_2, missing: true })];
    const { sink, lifecycle, sent } = harness(parts);

    await sink.onDeadLetter(Q_PROCESS_PART, payload, { errorType: "x", reason: "y", exhausted: true });

    // There is no call left to summarize; a summary of nothing is worse than
    // an honest failure.
    expect(lifecycle.failCall).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});

describe("a dead-lettered PER-CALL step", () => {
  it("fails the call, visibly and with the reason", async () => {
    const { sink, lifecycle } = harness([part({})]);

    await sink.onDeadLetter(Q_SUMMARIZE, { callId: CALL, ownerId: OWNER }, {
      errorType: "agent_failed",
      reason: "provider refused",
      exhausted: true,
    });

    expect(lifecycle.failCall).toHaveBeenCalledWith(
      expect.anything(),
      CALL,
      expect.stringContaining("agent_failed"),
    );
    expect(lifecycle.markPartMissing).not.toHaveBeenCalled();
  });
});

describe("when the owner cannot be resolved", () => {
  it("writes nothing at all rather than writing as somebody else", async () => {
    const lifecycle = {
      getPart: vi.fn(), partsOfCall: vi.fn(), setPartStatus: vi.fn(), setCallStatus: vi.fn(),
      markPartMissing: vi.fn(), noteSummarySkipped: vi.fn(), failCall: vi.fn(), bumpAttempts: vi.fn(),
    } as unknown as Lifecycle & Record<string, ReturnType<typeof vi.fn>>;

    // A payload whose owner id is not a UUID: identityForJob throws.
    const db = { withActor: async () => { throw new Error("invalid actor id"); } } as never;
    const sink = createDeadLetterSink({ db, lifecycle, queue: {} as Queue, log: silent });

    await sink.onDeadLetter(Q_PROCESS_PART, { callId: "c", ownerId: "not-a-uuid", partId: "p" }, {
      errorType: "x", reason: "y", exhausted: true,
    });

    // No identity, no write — not even for bookkeeping. Invariant 2 has no
    // convenience exception.
    expect(lifecycle.markPartMissing).not.toHaveBeenCalled();
    expect(lifecycle.failCall).not.toHaveBeenCalled();
  });
});
