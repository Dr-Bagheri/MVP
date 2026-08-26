import { describe, expect, it } from "vitest";
import { planSnippet } from "./voiceSnippet";
import type { CaptionRow } from "./captionRows";

const row = (speaker: string | undefined, atMs: number, text = "…"): CaptionRow =>
  speaker === undefined ? { atMs, text } : { atMs, text, speaker };

/**
 * The refusals are the point. A planner that always returns a window would
 * pass a "it plans a window" test and then hand the matcher audio from a
 * handover, which is how somebody else's name lands on your sentence.
 */
describe("planSnippet", () => {
  const NOW = 30_000;

  it("plans a window inside a long single-voice run", () => {
    const rows = [row("1", 14_000), row("1", 20_000), row("1", 27_000)];
    expect(planSnippet(rows, NOW)).toEqual({ label: "1", startMs: 23_000, endMs: 27_000 });
  });

  it("the window ends BEFORE now — recognition runs behind the room", () => {
    const plan = planSnippet([row("1", 14_000), row("1", 27_000)], NOW)!;
    expect(plan.endMs).toBeLessThan(NOW);
    expect(NOW - plan.endMs).toBeGreaterThanOrEqual(3_000);
  });

  it("refuses when anyone else spoke in the stretch", () => {
    // the handover case: one word from another voice and the window is
    // no longer provably one person's
    const rows = [row("1", 14_000), row("2", 22_000), row("1", 27_000)];
    expect(planSnippet(rows, NOW)).toBeNull();
  });

  it("refuses a run that started too recently to cover the window", () => {
    // the voice has spoken, but only after the audio the window would cut
    expect(planSnippet([row("1", 26_000)], NOW)).toBeNull();
  });

  it("refuses when nobody has spoken lately", () => {
    expect(planSnippet([row("1", 1_000)], NOW)).toBeNull();
  });

  it("ignores rows with no speaker at all (an undiarized lane)", () => {
    expect(planSnippet([row(undefined, 14_000), row(undefined, 27_000)], NOW)).toBeNull();
  });
});
