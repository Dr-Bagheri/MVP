import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingRecord } from "../src/api/meetings.ts";

/**
 * WHAT IS NEXT, AND HOW SOON.
 *
 * `list_meetings` returned every meeting the repo had, in the repo's order,
 * with a `scheduled_at` the model had to subtract from a clock it does not
 * have. Asked "what should I do now", it either listed a held meeting from
 * last week or did the arithmetic wrong. The row carries the minutes now,
 * counted from the SERVER's clock, and `upcoming:true` is the question the
 * person is actually asking: still ahead, not yet recording, soonest first.
 *
 * The repo is faked at the module seam (rule 11: the thing under test is
 * the tool's arithmetic and filter, not `rowsSql` and RLS — those have their
 * own tests). The fixture is the shape `MeetingRecord` publishes, and the
 * time is frozen so a minute count is a fact rather than a race.
 */
const list = vi.fn<(identity: unknown, opts: { archived?: boolean }) => Promise<MeetingRecord[]>>();
vi.mock("../src/api/meetings.ts", () => ({
  createMeetingsRepo: () => ({ list }),
}));

const { createPlatformTools, withStartsIn } = await import("../src/agent/platform-tools.ts");

const NOW = Date.parse("2026-09-08T10:00:00.000Z");

function meeting(id: string, minutesFromNow: number, callId: string | null = null): MeetingRecord {
  return {
    id,
    title: `meeting ${id}`,
    scheduled_at: new Date(NOW + minutesFromNow * 60_000).toISOString(),
    duration_minutes: 30,
    mode: "online",
    topic_id: null,
    topic: null,
    location: null,
    description: "",
    invitees: [],
    attendees: [],
    agenda: [],
    call_id: callId,
    call_title: null,
    call_status: null,
    presenting_attachment_id: null,
    archived: false,
    created_by: "u-1",
  } as unknown as MeetingRecord;
}

/* deliberately NOT in start order, so a sorted answer is evidence of a sort */
const FIXTURE = [
  meeting("later", 90),
  meeting("held", -30),
  meeting("recording", 15, "call-1"),
  meeting("soon", 5),
];

const tool = () => createPlatformTools().find((t) => t.name === "list_meetings")!;
const run = (args: Record<string, unknown>) =>
  tool().run(
    { identity: { userId: "u-1", orgId: "o-1", role: "member", isActive: true }, deps: { db: {} } } as never,
    args as never,
  ) as Promise<{ items: (MeetingRecord & { starts_in_minutes?: number })[]; count: number; truncated: boolean }>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  list.mockReset();
  list.mockResolvedValue(FIXTURE.map((row) => ({ ...row })));
});
afterEach(() => vi.useRealTimers());

describe("withStartsIn", () => {
  it("counts whole minutes ahead from the clock it is given", () => {
    expect(withStartsIn(meeting("a", 90), NOW).starts_in_minutes).toBe(90);
    /* 59 seconds ahead is "in 1 minute", not "now" — a meeting that has not
       started must not read as starting */
    const inFiftyNine = { ...meeting("b", 0), scheduled_at: new Date(NOW + 59_000).toISOString() };
    expect(withStartsIn(inFiftyNine, NOW).starts_in_minutes).toBe(1);
  });

  it("carries NO number for a meeting not ahead — the control", () => {
    expect(withStartsIn(meeting("past", -30), NOW)).not.toHaveProperty("starts_in_minutes");
    expect(withStartsIn({ ...meeting("bad", 5), scheduled_at: "not a date" }, NOW))
      .not.toHaveProperty("starts_in_minutes");
  });
});

describe("list_meetings", () => {
  it("annotates every row still ahead, and leaves the rest alone", async () => {
    const { items } = await run({});
    expect(items.map((r) => r.id)).toEqual(["later", "held", "recording", "soon"]);
    const byId = Object.fromEntries(items.map((r) => [r.id, r.starts_in_minutes]));
    expect(byId).toEqual({ later: 90, held: undefined, recording: 15, soon: 5 });
    /* the row shape is the repo's — scheduled_at travels beside the count */
    expect(items[0]!.scheduled_at).toBe(FIXTURE[0]!.scheduled_at);
  });

  it("upcoming:true is still-ahead AND not-yet-recording, soonest first", async () => {
    const { items, count, truncated } = await run({ upcoming: true });
    /* "held" is behind; "recording" is ahead by the clock but has a call_id,
       which the recorder writes the moment a take exists (0145) — it is
       "now", not "next" */
    expect(items.map((r) => r.id)).toEqual(["soon", "later"]);
    expect(items.map((r) => r.starts_in_minutes)).toEqual([5, 90]);
    expect(count).toBe(2);
    expect(truncated).toBe(false);
  });

  it("limit caps the answer and says so", async () => {
    const { items, truncated } = await run({ upcoming: true, limit: 1 });
    expect(items.map((r) => r.id)).toEqual(["soon"]);
    expect(truncated).toBe(true);
  });

  it("passes `archived` through to the repo and defaults it off", async () => {
    await run({});
    expect(list).toHaveBeenLastCalledWith(expect.anything(), { archived: false });
    await run({ archived: true });
    expect(list).toHaveBeenLastCalledWith(expect.anything(), { archived: true });
  });

  it("reads the clock at the moment of the call, not at module load", async () => {
    /* the same fixture, an hour later: the counts move with the server's
       clock — a number frozen at import would be right once */
    vi.setSystemTime(NOW + 60 * 60_000);
    const { items } = await run({ upcoming: true });
    expect(items.map((r) => r.id)).toEqual(["later"]);
    expect(items[0]!.starts_in_minutes).toBe(30);
  });
});
