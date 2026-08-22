import { describe, expect, it } from "vitest";
import { recoveryPlan, type BufferedPart } from "./takeBuffer";

/**
 * The pure half of the crash buffer — the plan's three rules. (The
 * IndexedDB wrapper itself is browser wiring, thin and best-effort by
 * design; what must be RIGHT is which parts recover, in what order.)
 */
const part = (over: Partial<BufferedPart>): BufferedPart => ({
  callId: "call-a",
  partIdx: 0,
  offsetMs: 0,
  mime: "audio/webm",
  title: "جلسه ۱",
  updatedAt: 1_000,
  bytes: 100,
  ...over,
});

describe("recoveryPlan", () => {
  it("groups by call; parts upload in idx order (the honest-prefix rule)", () => {
    const plan = recoveryPlan([
      part({ partIdx: 2, offsetMs: 120_000 }),
      part({ partIdx: 0 }),
      part({ callId: "call-b", title: "Meeting 2", updatedAt: 2_000 }),
      part({ partIdx: 1, offsetMs: 60_000 }),
    ]);
    expect(plan).toHaveLength(2);
    const a = plan.find((c) => c.callId === "call-a")!;
    expect(a.parts.map((p) => p.partIdx)).toEqual([0, 1, 2]);
  });

  it("most recent activity first — the take just lost is the one on top", () => {
    const plan = recoveryPlan([
      part({ callId: "old", updatedAt: 1_000 }),
      part({ callId: "fresh", updatedAt: 9_000 }),
    ]);
    expect(plan.map((c) => c.callId)).toEqual(["fresh", "old"]);
  });

  it("a zero-byte part never recovers — registering silence is not recovery", () => {
    const plan = recoveryPlan([part({ bytes: 0 })]);
    expect(plan).toHaveLength(0);
  });
});
