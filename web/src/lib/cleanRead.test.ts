/**
 * The clean-read filter's whole risk is over-stripping: the negative
 * controls (meaningful words that LOOK like fillers) are the tests that
 * matter — «خب» is a real word, "umbrella" starts with um, «آب» starts
 * with آ. A filter that eats one of those is an edit wearing a view.
 */
import { describe, expect, it } from "vitest";
import { isFillerWord, stripFillers } from "./cleanRead";

describe("isFillerWord", () => {
  it("catches the hesitation sounds, both languages, punctuation glued on", () => {
    for (const w of ["um", "Uh", "uhm", "erm", "hmm", "mmm", "um,", "اوم", "اوم،", "هوم", "اِم", "آآ"]) {
      expect(isFillerWord(w), w).toBe(true);
    }
  });

  it("NEVER strips words that carry meaning — the negative controls", () => {
    for (const w of ["خب", "umbrella", "آب", "مثلاً", "like", "hammer", "err…code", "امروز", "او"]) {
      expect(isFillerWord(w), w).toBe(false);
    }
  });

  it("stripFillers cleans a text row without touching the rest", () => {
    expect(stripFillers("خب اوم فردا جلسه داریم هوم ساعت ده")).toBe("خب فردا جلسه داریم ساعت ده");
    expect(stripFillers("so um the plan is uh ready")).toBe("so the plan is ready");
    // a row that is ONLY filler cleans to empty — the caller renders it as such
    expect(stripFillers("اوم هوم")).toBe("");
  });
});
