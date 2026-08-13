/**
 * SPEC's three write tools and the proposal/approval flow (M4).
 *
 * The load-bearing assertion in this file is the negative one: **a write tool
 * issues no UPDATE and no INSERT.** Everything else here is shape. If that
 * one ever passes while being false, the approval flow is decorative — the
 * agent would be writing and the card would be theatre.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/pi.ts", async () => {
  const { Type } = await import("@earendil-works/pi-ai");
  return { Type, catalogue: () => [], runPi: vi.fn(), resolveModel: vi.fn(), reasoningFor: vi.fn() };
});

const { createWriteTools, applyProposal } = await import("../src/agent/write-tools.ts");
const { AlreadyDecidedError, findProposal, recordDecision, validatePayload } =
  await import("../src/agent/proposals.ts");
import { NotFoundError, ValidationError } from "../src/api/errors.ts";
import { ToolDenied } from "../src/agent/tools.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";
import type { WriteProposal } from "../src/agent/proposals.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const SEGMENT = "44444444-4444-4444-8444-444444444444";
const SPEAKER = "55555555-5555-4555-8555-555555555555";
const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined; pool: string }[] = [];
  const make = (pool: string): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params, pool });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make("app"), agent: make("agent") }) };
}

interface LogLine { sql: string; params?: unknown[] | undefined; pool: string }

const mutations = (log: LogLine[]): LogLine[] =>
  log.filter((l) => /\b(update|insert|delete)\b/i.test(l.sql) && !l.sql.includes("set local"));

const tools = createWriteTools();
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, db: ReturnType<typeof createDb>, args: unknown) =>
  tool(name).run({ identity: IDENTITY, deps: { db } }, args as never);

describe("a write tool PROPOSES and does not write", () => {
  it("issues no mutation at all — the whole flow rests on this", async () => {
    const { db, log } = fakeDb((sql) => {
      if (sql.includes("transcript_segment")) {
        return [{ call_id: CALL, text: "متن قدیمی", start_ms: 12_000 }];
      }
      return [];
    });
    const result = await run("correct_transcript", db, { segment_id: SEGMENT, text: "متن اصلاح‌شده" });
    expect(mutations(log)).toHaveLength(0);
    expect((result as { status: string }).status).toBe("awaiting_confirmation");
  });

  it("tells the MODEL it is awaiting confirmation, not that it is done", async () => {
    // If the tool result read as success, the assistant would tell the user
    // the transcript was corrected while nothing had changed — worse than
    // refusing, because the user stops checking.
    const { db } = fakeDb(() => [{ call_id: CALL, text: "قدیمی", start_ms: 0 }]);
    const result = await run("correct_transcript", db, { segment_id: SEGMENT, text: "نو" });
    expect(JSON.stringify(result)).toContain("awaiting_confirmation");
    expect(JSON.stringify(result)).not.toMatch(/"(applied|done|success)"\s*:/);
  });

  it("carries BEFORE and AFTER, as a matched pair", async () => {
    // A card showing only the current value asks for consent while looking
    // like it asks for judgement. I shipped `before` with no counterpart and
    // the frontend caught it — their card's before/after branch was
    // unreachable, so it would have rendered as finished showing one side.
    const { db } = fakeDb(() => [{ call_id: CALL, text: "بودجه سی درصد", start_ms: 5_000 }]);
    const result = await run("correct_transcript", db, { segment_id: SEGMENT, text: "بودجه سیزده درصد" });
    const proposal = (result as { proposal: WriteProposal }).proposal;
    expect(proposal.before).toEqual({ text: "بودجه سی درصد" });
    expect(proposal.after).toEqual({ text: "بودجه سیزده درصد" });
    // same SHAPE on both sides — a difference in shape is one the reader has
    // to reconcile before they can compare the values
    expect(Object.keys(proposal.after as object)).toEqual(Object.keys(proposal.before as object));
    expect(proposal.summary).toContain("5");   // the timestamp
    expect(proposal.call_id).toBe(CALL);
  });

  it("gives every kind an after, including a first-ever summary", async () => {
    // `before` is legitimately absent for a first summary; `after` never is.
    // Absent `after` means "no change proposed", which is not a state a
    // proposal can be in.
    const { db } = fakeDb((sql) => {
      if (sql.includes("from echo.summary")) return [];   // no prior version
      if (sql.includes("echo.call")) {
        return [{
          id: CALL, title: "مذاکره", scope: "private", status: "ready", language: "fa",
          started_at: new Date("2026-08-12T09:00:00Z"), duration_ms: 1_000, owner_id: ALICE,
          transcribed_part_count: 1, timed_part_count: 1,
        }];
      }
      return [];
    });
    const result = await run("replace_summary", db, { call_id: CALL, body: "نخستین خلاصه" });
    const proposal = (result as { proposal: WriteProposal }).proposal;
    expect(proposal.before).toBeUndefined();
    expect(proposal.after).toEqual({ version: 1, body: "نخستین خلاصه" });
  });

  it("keeps before/after as DISPLAY values — payload is what applies", async () => {
    // They may be excerpted; the payload never is. Applying `after` would
    // silently truncate a long correction to the card's excerpt length.
    const long = "ب".repeat(600);
    const { db } = fakeDb(() => [{ call_id: CALL, text: "کوتاه", start_ms: 0 }]);
    const result = await run("correct_transcript", db, { segment_id: SEGMENT, text: long });
    const proposal = (result as { proposal: WriteProposal }).proposal;
    expect((proposal.after as { text: string }).text.length).toBeLessThan(long.length);
    expect((proposal.payload as { text: string }).text).toBe(long);
  });

  it("refuses a no-op instead of spending a human's attention", async () => {
    const { db } = fakeDb(() => [{ call_id: CALL, text: "همان متن", start_ms: 0 }]);
    await expect(run("correct_transcript", db, { segment_id: SEGMENT, text: "همان متن" }))
      .rejects.toBeInstanceOf(ToolDenied);
  });

  it("refuses an invisible target the same way for every write tool", async () => {
    const { db } = fakeDb(() => []);
    await expect(run("correct_transcript", db, { segment_id: SEGMENT, text: "x" }))
      .rejects.toBeInstanceOf(ToolDenied);
    await expect(run("edit_speaker_roster", db, { speaker_id: SPEAKER, label: "علی" }))
      .rejects.toBeInstanceOf(ToolDenied);
    await expect(run("replace_summary", db, { call_id: CALL, body: "خلاصه" }))
      .rejects.toBeInstanceOf(ToolDenied);
  });

  it("names the version it would write, so 'replace' cannot read as 'overwrite'", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("from echo.summary")) return [{ version: 2, body: "خلاصهٔ قبلی" }];
      if (sql.includes("echo.call")) {
        return [{
          id: CALL, title: "مذاکره", scope: "private", status: "ready", language: "fa",
          started_at: new Date("2026-08-12T09:00:00Z"), duration_ms: 1_000, owner_id: ALICE,
          transcribed_part_count: 1, timed_part_count: 1,
        }];
      }
      return [];
    });
    const result = await run("replace_summary", db, { call_id: CALL, body: "خلاصهٔ تازه" });
    const proposal = (result as { proposal: WriteProposal }).proposal;
    expect(proposal.summary).toContain("3");        // version 2 → writes 3
    expect((proposal.before as { version: number }).version).toBe(2);
  });
});

describe("applying an approved proposal", () => {
  const proposal = (over: Partial<WriteProposal> = {}): WriteProposal => ({
    id: "p1", kind: "correct_transcript", call_id: CALL,
    summary: "s", payload: { segment_id: SEGMENT, text: "اصلاح‌شده" }, ...over,
  });

  it("runs on the AGENT role — the column grants are the floor", async () => {
    // echo_agent may update (text, words) and nothing else; echo_app could
    // rewrite the row. A human approved the CONTENT, not a wider grant.
    const { db, log } = fakeDb(() => [{ id: SEGMENT }]);
    await applyProposal(db, IDENTITY, proposal(), RUN);
    const write = mutations(log)[0]!;
    expect(write.pool).toBe("agent");
    expect(write.sql).toContain("update echo.transcript_segment");
  });

  it("clears words with the text, rather than leaving stale timings", async () => {
    // Keeping word timings against corrected text would put a seek
    // affordance on words that were never said. M20's ladder already handles
    // an empty array as line-level timing.
    const { db, log } = fakeDb(() => [{ id: SEGMENT }]);
    await applyProposal(db, IDENTITY, proposal(), RUN);
    expect(mutations(log)[0]!.sql).toContain("words = '[]'::jsonb");
  });

  it("writes a summary as a new VERSION, never an update", async () => {
    const { db, log } = fakeDb(() => [{ id: "sum-3" }]);
    await applyProposal(db, IDENTITY, proposal({
      kind: "replace_summary", payload: { body: "نو", model: "agent" },
    }), RUN);
    const write = mutations(log)[0]!;
    expect(write.sql).toContain("insert into echo.summary");
    expect(write.sql).not.toMatch(/update\s+echo\.summary/i);
    // linked to the run whose steps hold the proposal and its approval
    expect(write.params).toContain(RUN);
  });

  it("RE-validates at confirm time, because the confirm is the write", async () => {
    // Minutes pass between propose and confirm. A payload that was fine then
    // must still be fine now — and a tampered stored payload must not apply.
    const { db, log } = fakeDb(() => [{ id: SEGMENT }]);
    await expect(applyProposal(db, IDENTITY, proposal({ payload: { segment_id: SEGMENT, text: "  " } }), RUN))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mutations(log)).toHaveLength(0);
  });

  it("reports a vanished or now-invisible target as 404, not a silent success", async () => {
    const { db } = fakeDb(() => []);   // RLS refuses, or the row is gone
    await expect(applyProposal(db, IDENTITY, proposal(), RUN)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("finding and deciding", () => {
  it("reads the proposal from agent_run.steps, never from the caller", async () => {
    const stored = { id: "p1", kind: "correct_transcript", call_id: CALL, summary: "s", payload: {} };
    const { db, log } = fakeDb(() => [{ proposal: stored }]);
    const found = await findProposal(db, IDENTITY, RUN, "p1");
    expect(found).toEqual(stored);
    const query = log.find((l) => l.sql.includes("agent_run"))!;
    // queryable jsonb is what makes this possible — the double-encoded shape
    // returned nothing from exactly this expression
    expect(query.sql).toContain("jsonb_array_elements(steps)");
    expect(query.params).toEqual([RUN, "p1"]);
  });

  it("is 404 for an unknown proposal, a foreign run, and an invisible run alike", async () => {
    const { db } = fakeDb(() => []);
    await expect(findProposal(db, IDENTITY, RUN, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records a REJECTION as its own decision row", async () => {
    // "the agent proposed this and a person said no" is the history an
    // approval flow exists to keep, and db/0029 gives it the same primary key
    // as an approval — so a proposal cannot be rejected and then approved.
    const { db, log } = fakeDb(() => []);
    await recordDecision(db, IDENTITY, {
      runId: RUN,
      proposal: { id: "p1", kind: "edit_speaker_roster", call_id: CALL, summary: "s", payload: {} },
      decision: "rejected",
    });
    const write = mutations(log)[0]!;
    expect(write.sql).toContain("insert into echo.proposal_decision");
    expect(write.params).toContain("reject");
    expect(write.params).toContain(ALICE);      // decided_by
    expect(write.params).toContain("p1");       // the primary key
    // echo_app, not echo_agent: 0029 gives the agent no grant here at all —
    // "the agent proposes; it does not decide".
    expect(write.pool).toBe("app");
  });

  it("turns the primary key's 23505 into AlreadyDecided, not a 500", async () => {
    // The replay refusal IS the constraint. A second confirm never reaches
    // the write, which is what makes a double-click safe: a replayed
    // replace_summary would otherwise write a second version.
    const { db } = fakeDb(() => { throw Object.assign(new Error("dup"), { code: "23505" }); });
    await expect(recordDecision(db, IDENTITY, {
      runId: RUN,
      proposal: { id: "p1", kind: "correct_transcript", call_id: CALL, summary: "s", payload: {} },
      decision: "confirmed",
    })).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it("keeps proposed CONTENT out of the decision row", async () => {
    // A step is an audit record; transcript text does not belong in one.
    const { db, log } = fakeDb(() => []);
    await recordDecision(db, IDENTITY, {
      runId: RUN,
      proposal: {
        id: "p1", kind: "correct_transcript", call_id: CALL, summary: "s",
        payload: { segment_id: SEGMENT, text: "متن محرمانه" },
      },
      decision: "confirmed",
    });
    expect(JSON.stringify(mutations(log)[0]!.params)).not.toContain("محرمانه");
  });
});

describe("payload validation is one function, used at both ends", () => {
  it("rejects empty, oversized and malformed payloads", () => {
    expect(() => validatePayload("correct_transcript", { segment_id: SEGMENT, text: "" })).toThrow(ValidationError);
    expect(() => validatePayload("correct_transcript", { segment_id: "nope", text: "x" })).toThrow(/invalid segment id/);
    expect(() => validatePayload("edit_speaker_roster", { speaker_id: SPEAKER, label: "  " })).toThrow(ValidationError);
    expect(() => validatePayload("replace_summary", { body: "x" })).toThrow(/model/);
    expect(() => validatePayload("nonsense" as never, {})).toThrow(/unknown proposal kind/);
  });

  it("accepts the shapes the tools produce", () => {
    expect(validatePayload("correct_transcript", { segment_id: SEGMENT, text: "متن" }))
      .toEqual({ segment_id: SEGMENT, text: "متن" });
    expect(validatePayload("edit_speaker_roster", { speaker_id: SPEAKER, label: " علی " }))
      .toEqual({ speaker_id: SPEAKER, label: "علی" });
  });
});
