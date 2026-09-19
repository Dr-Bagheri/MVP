import { describe, expect, it, vi } from "vitest";

import { extractClaims } from "../src/worker/summarizer.ts";

/**
 * The extraction pass, at the seam where it decides whether to spend a
 * model call and what it hands back (2026-09-10, five kinds since 2026-09-19).
 *
 * Three things are pinned here. The MEETING is looked up BEFORE the model is
 * asked: a plain upload has no meeting page for its items to land on, and
 * until 2026-09-10 the pass spent a provider call on every such recording to
 * then write nothing. The pass returns WHERE the items landed — the meeting
 * and the ids of the rows the repo actually inserted — because the step that
 * follows delivers the aftermath (db/0217) and must name the rows it is
 * delivering. And it returns what it produced PER KIND, because a total of
 * "four" cannot tell a pass that read the whole meeting from one that only
 * ever finds decisions — which is what the user's "it is weak in
 * understanding them" looked like from the log.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const CAROL = "33333333-3333-4333-8333-333333333333";
const ORG = "55555555-5555-4555-8555-555555555555";
const CALL = "22222222-2222-4222-8222-222222222222";
const MEETING = "16000000-0000-4000-8000-000000000a01";
const identity = { userId: OWNER, orgId: ORG, role: "member", isActive: true } as never;

/* the model's answer, in the shape it actually answers: one row per kind,
   the owner and the day on the two kinds that carry them, a legacy
   `commitment` beside the schema's own `action` so the alias path is on the
   wire too */
const answer = JSON.stringify({
  items: [{
    kind: "commitment", text: "گزارش هزینه‌ها را تا شنبه می‌فرستم", detail: "",
    owner_name: "کارول", due_on: "2026-09-13", start_ms: 1000, end_ms: 4000,
  }, {
    kind: "decision", text: "بودجهٔ مهر تصویب شد", detail: "",
    owner_name: null, due_on: null, start_ms: null, end_ms: null,
  }, {
    kind: "project", text: "برای دیتابیس صوتی یه پروژهٔ جدا باز کنیم", detail: "",
    owner_name: "کارول", due_on: null, start_ms: 9000, end_ms: 12000,
  }, {
    kind: "question", text: "بودجهٔ سرور از کجا می‌آید؟", detail: "",
    owner_name: null, due_on: null, start_ms: 20000, end_ms: 23000,
  }, {
    kind: "risk", text: "اگر دیتا نرسه فاز دوم عقب می‌افته", detail: "",
    owner_name: null, due_on: null, start_ms: 30000, end_ms: 34000,
  }, {
    kind: "action", text: "من فردا سرور رو راه می‌ندازم", detail: "",
    owner_name: "Speaker 3", due_on: null, start_ms: 40000, end_ms: 42000,
  }],
});

function fakes(over: { meeting?: string | null; text?: string; failed?: boolean } = {}) {
  const run = vi.fn(async () => ({ failed: over.failed ?? false, text: over.text ?? answer }));
  const recordExtracted = vi.fn(async (_i: unknown, _m: string, rows: unknown[]) => ({
    landed: rows.length,
    itemIds: rows.map((_, i) => `item-${i}`),
  }));
  const meetings = {
    meetingIdForCall: vi.fn(async () => (over.meeting === undefined ? MEETING : over.meeting)),
    roster: vi.fn(async () => [{ id: CAROL, names: ["کارول", "Carol"] }]),
    recordExtracted,
  };
  return { run, recordExtracted, meetings };
}

async function extract(f: ReturnType<typeof fakes>) {
  return extractClaims({
    runtime: { run: f.run } as never,
    identity, callId: CALL, transcript: "کارول: گزارش هزینه‌ها را تا شنبه می‌فرستم",
    meetings: f.meetings as never, deps: undefined,
  });
}

describe("the extraction pass", () => {
  it("does NOT ask the model about a recording that belongs to no meeting", async () => {
    const f = fakes({ meeting: null });
    const out = await extract(f);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.recordExtracted).not.toHaveBeenCalled();
    expect(out).toEqual({ claims: 0, meetingId: null, itemIds: [], kinds: {} });
  });

  it("THE CONTROL: with a meeting it asks once, files all five kinds, resolves the owners, and returns where the rows landed", async () => {
    const f = fakes();
    const out = await extract(f);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.recordExtracted).toHaveBeenCalledTimes(1);
    const [, meetingId, rows] = f.recordExtracted.mock.calls[0]!;
    expect(meetingId).toBe(MEETING);
    expect(rows).toEqual([
      /* `commitment` is the ledger's `action` */
      expect.objectContaining({ kind: "action", ownerId: CAROL, owner: "کارول", dueOn: "2026-09-13", atMs: 1000 }),
      expect.objectContaining({ kind: "decision", ownerId: null, owner: null }),
      /* a proposed project keeps the person the meeting named to lead it */
      expect.objectContaining({ kind: "project", ownerId: CAROL, owner: "کارول", atMs: 9000 }),
      expect.objectContaining({ kind: "question", ownerId: null, owner: null, atMs: 20000 }),
      expect.objectContaining({ kind: "risk", ownerId: null, owner: null, atMs: 30000 }),
      /* the product's own name for a voice is not an owner: resolved to
         nobody AND not kept as the spoken name */
      expect.objectContaining({ kind: "action", ownerId: null, owner: null, atMs: 40000 }),
    ]);
    expect(out).toEqual({
      claims: 6, meetingId: MEETING,
      itemIds: ["item-0", "item-1", "item-2", "item-3", "item-4", "item-5"],
      kinds: { action: 2, decision: 1, project: 1, question: 1, risk: 1 },
    });
  });

  it("an unreadable answer is null claims — and the meeting is still named, so the roster can still be told", async () => {
    const f = fakes({ text: "متأسفم، نتوانستم." });
    const out = await extract(f);
    expect(f.recordExtracted).not.toHaveBeenCalled();
    expect(out).toEqual({ claims: null, meetingId: MEETING, itemIds: [], kinds: {} });
  });

  it("a failed run is the same null, not a zero", async () => {
    const f = fakes({ failed: true });
    expect((await extract(f)).claims).toBeNull();
  });

  it("a meeting where nothing was produced is zero claims with the meeting named", async () => {
    const f = fakes({ text: '{"items":[]}' });
    const out = await extract(f);
    expect(f.recordExtracted).not.toHaveBeenCalled();
    expect(out).toEqual({ claims: 0, meetingId: MEETING, itemIds: [], kinds: {} });
  });

  it("a kind the model invented is not filed, and does not count", async () => {
    /* the old parser filed anything but 'commitment' as a decision, so a
       model's 'suggestion' became a decided thing; the kinds tally is what
       makes the drop visible in a log rather than only in the ledger */
    const f = fakes({ text: JSON.stringify({ items: [
      { kind: "suggestion", text: "شاید بهتر باشد", owner_name: null },
      { kind: "risk", text: "ممکن است دیر شود", owner_name: null },
    ] }) });
    const out = await extract(f);
    const [, , rows] = f.recordExtracted.mock.calls[0]!;
    expect((rows as unknown[]).length).toBe(1);
    expect(out.kinds).toEqual({ risk: 1 });
  });
});
