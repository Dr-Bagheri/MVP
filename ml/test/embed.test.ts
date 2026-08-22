/**
 * The embed lane's PURE half — slicing and scoring. The model half runs in
 * test/smoke/embedding-live.ts at acceptance (real extractor, real voices):
 * a suite green here says the arithmetic is right, NOT that a vector was
 * ever produced — rule 7's positive detection lives in the smoke.
 */
import { describe, expect, it } from "vitest";

import { cosine, sliceRanges } from "../src/embed/extractor.js";

describe("sliceRanges", () => {
  const rate = 1000; // 1 sample per ms — offsets readable by eye
  const samples = Float32Array.from({ length: 10_000 }, (_, i) => i);

  it("no ranges = the whole take", () => {
    expect(sliceRanges(samples, rate, [])).toBe(samples);
  });

  it("concatenates exactly the requested speech, in order", () => {
    const out = sliceRanges(samples, rate, [
      { start_ms: 1000, end_ms: 1003 },
      { start_ms: 5000, end_ms: 5002 },
    ]);
    expect(Array.from(out)).toEqual([1000, 1001, 1002, 5000, 5001]);
  });

  it("clamps a range that runs past the audio instead of inventing silence", () => {
    const out = sliceRanges(samples, rate, [{ start_ms: 9998, end_ms: 12_000 }]);
    expect(Array.from(out)).toEqual([9998, 9999]);
  });

  it("an inverted or out-of-bounds range contributes nothing", () => {
    const out = sliceRanges(samples, rate, [
      { start_ms: 500, end_ms: 400 },
      { start_ms: 20_000, end_ms: 21_000 },
      { start_ms: 0, end_ms: 2 },
    ]);
    expect(Array.from(out)).toEqual([0, 1]);
  });
});

describe("cosine", () => {
  it("identical direction is 1, orthogonal is 0, opposite is -1", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("degenerate inputs score 0, never NaN — a NaN threshold comparison is always false and looks like 'no match'", () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});
