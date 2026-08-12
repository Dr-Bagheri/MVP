// The WER metric, checked against hand-computed values.
//
// Every assertion here is POSITIVE — a specific number for a specific input
// (M19). "Doesn't crash" and "returns something between 0 and 1" are satisfied
// by an implementation that returns 0.5 for everything, which is exactly the
// failure mode a broken model already walked through this package once.

import { describe, expect, it } from "vitest";
import { normalizeFa, tokenize, wordErrorRate } from "./wer/metric.js";

describe("Persian normalization", () => {
  it("unifies the Arabic and Persian letterforms of the same word", () => {
    // ARABIC YEH/KEHEH vs PERSIAN YEH/KEHEH: identical words, different
    // keyboards. Counting these as errors measures the provider's training
    // corpus, not its hearing.
    expect(normalizeFa("كيف")).toBe(normalizeFa("کیف"));
    expect(normalizeFa("علي")).toBe("علی");
  });

  it("treats a ZWNJ and a space as the same boundary", () => {
    // «می‌خوایم» joined vs «می خوایم» spaced is a typing convention.
    expect(tokenize("می‌خوایم")).toEqual(tokenize("می خوایم"));
    expect(tokenize("می‌خوایم")).toEqual(["می", "خوایم"]);
  });

  it("folds alef variants, harakat and tatweel", () => {
    expect(normalizeFa("آب")).toBe("اب");
    expect(normalizeFa("مُحَمَّد")).toBe("محمد");
    expect(normalizeFa("سـلام")).toBe("سلام");
  });

  it("converts Persian and Arabic digits to one form", () => {
    expect(normalizeFa("۱۴۰۳")).toBe("1403");
    expect(normalizeFa("٢٠٢٦")).toBe("2026");
  });

  it("drops punctuation from both alphabets", () => {
    expect(normalizeFa("سلام، خوبی؟")).toBe("سلام خوبی");
    expect(normalizeFa("«اکو»")).toBe("اکو");
  });

  it("leaves a genuinely different word different", () => {
    // The normalizer must not be so aggressive that real errors vanish.
    expect(normalizeFa("کتاب")).not.toBe(normalizeFa("کباب"));
  });
});

describe("word error rate", () => {
  it("is 0 for an exact match", () => {
    const r = wordErrorRate("سلام حال شما چطور است", "سلام حال شما چطور است");
    expect(r.wer).toBe(0);
    expect(r.hits).toBe(5);
  });

  it("is 0 when the texts differ ONLY in orthography", () => {
    // The whole point of normalizing first.
    const r = wordErrorRate("می‌خواهم كتاب ۵", "می خواهم کتاب 5");
    expect(r.wer).toBe(0);
  });

  it("counts one substitution in five words as 20%", () => {
    const r = wordErrorRate("سلام حال شما چطور است", "سلام حال شما چطور نیست");
    expect(r.substitutions).toBe(1);
    expect(r.wer).toBeCloseTo(0.2, 10);
  });

  it("counts a deletion", () => {
    const r = wordErrorRate("یک دو سه چهار", "یک دو چهار");
    expect(r.deletions).toBe(1);
    expect(r.insertions).toBe(0);
    expect(r.wer).toBeCloseTo(0.25, 10);
  });

  it("counts an insertion", () => {
    const r = wordErrorRate("یک دو سه", "یک دو دو سه");
    expect(r.insertions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.wer).toBeCloseTo(1 / 3, 10);
  });

  it("can exceed 100% when the lane invents more than it hears", () => {
    // WER is not a percentage of anything bounded — a hallucinating provider
    // scores above 1.0, and clamping would hide the worst case.
    const r = wordErrorRate("یک", "یک دو سه چهار");
    expect(r.wer).toBeGreaterThan(1);
  });

  it("reports NaN for an empty reference rather than a perfect score", () => {
    // Returning 0 would claim a flawless measurement that never happened.
    expect(Number.isNaN(wordErrorRate("", "چیزی").wer)).toBe(true);
  });

  it("names WHICH words were wrong, not just how many", () => {
    // A bare percentage says a lane is worse; the alignment says how — and
    // "loses proper nouns" and "loses verbs" are very different verdicts.
    const r = wordErrorRate("من دکتر باقری هستم", "من دکتر باقر هستم");
    const subs = r.ops.filter((o) => o.type === "sub");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ reference: "باقری", hypothesis: "باقر" });
  });

  it("aligns around a dropped word instead of shifting everything after it", () => {
    // A naive position-by-position comparison would call all four words wrong.
    const r = wordErrorRate("الف ب پ ت", "الف پ ت");
    expect(r.hits).toBe(3);
    expect(r.deletions).toBe(1);
    expect(r.substitutions).toBe(0);
  });
});
