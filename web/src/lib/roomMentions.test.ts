import { describe, expect, it } from "vitest";
import { splitMentions } from "./roomMentions";
/*
 * THE PRODUCER'S OWN DECIDER, imported (rule 10/13½). `handoffTarget` is what
 * actually decides who takes the next turn; this file draws the chip. A
 * hand-copied belief about which tokens count would be two spellings of one
 * rule, and the one that drifts is the one nobody runs.
 */
import { handoffTarget } from "../../../core/src/api/rooms";

const ROSTER = [{ id: "a1", handle: "roya" }, { id: "a2", handle: "ava" }];
const HANDLES = ROSTER.map((agent) => agent.handle);

describe("a mention becomes a chip only when it names a colleague", () => {
  it("marks up a roster handle and leaves the rest as text", () => {
    const parts = splitMentions("لایهٔ وضعیت را می‌سپارم به @ava", HANDLES);
    expect(parts.map((p) => p.kind)).toEqual(["text", "mention"]);
    expect(parts[1]).toEqual({ kind: "mention", handle: "ava" });
  });

  it("leaves an invented handle as plain text — it reached nobody", () => {
    /* the question this file must answer NO to. A parser that chipped every
       @token would draw a hand-off that never happened, which is a rendering
       claiming a mechanism fired. */
    const parts = splitMentions("این را می‌سپارم به @finance", HANDLES);
    expect(parts.map((p) => p.kind)).toEqual(["text"]);
    expect(parts[0]).toEqual({ kind: "text", text: "این را می‌سپارم به @finance" });
  });

  it("names the ROSTER's spelling, not the message's", () => {
    // a chip must read as the room names the agent, whatever case was typed
    expect(splitMentions("@AVA بررسی کن", HANDLES)[0])
      .toEqual({ kind: "mention", handle: "ava" });
  });

  it("keeps the text either side, in order", () => {
    const parts = splitMentions("@roya و @ava هر دو", HANDLES);
    expect(parts).toEqual([
      { kind: "mention", handle: "roya" },
      { kind: "text", text: " و " },
      { kind: "mention", handle: "ava" },
      { kind: "text", text: " هر دو" },
    ]);
  });

  it("agrees with the producer about what a handle IS", () => {
    /*
     * The seam. If this file matched a wider token than `handoffTarget`, a
     * chip would appear for a word that hands work to nobody; narrower, and a
     * real hand-off would render as plain prose. Both are the same defect —
     * the screen describing a mechanism that did not run, or missing one that
     * did — so the two are asked the same questions.
     *
     * Note the ONE deliberate difference, stated so it is not read as drift:
     * the producer scans the FINAL LINE only, because a hand-off is how a turn
     * ends; the chip marks a mention anywhere, because it is about legibility.
     * These cases are all single-line, so the two answer identically.
     */
    for (const [text, expected] of [
      ["حالا نوبت @ava است", "a2"],
      ["می‌سپارم به @finance", null],
      ["@AVA لطفاً", "a2"],
      ["بدون هیچ اشاره‌ای", null],
    ] as const) {
      const chip = splitMentions(text, HANDLES).find((p) => p.kind === "mention");
      const target = handoffTarget(text, ROSTER, "a1");
      expect(
        chip === undefined ? null : ROSTER.find((a) => a.handle === chip.handle)!.id,
        `the chip and the hand-off disagree about "${text}"`,
      ).toBe(expected);
      expect(target, `the producer's own answer for "${text}"`).toBe(expected);
    }
  });
});
