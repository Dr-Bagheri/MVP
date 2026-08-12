import { describe, expect, it } from "vitest";
import { anchorTimelessWords } from "../src/pipeline.js";
import type { Word } from "../src/schema.js";

const word = (text: string): Word => ({
  text,
  start_ms: 0,
  end_ms: 0,
  confidence: null,
  speaker: null,
  channel: null,
  language: null,
});

describe("anchorTimelessWords", () => {
  it("spans from the first speech to the last", () => {
    const out = anchorTimelessWords([word("a"), word("b")], [
      { start_ms: 2000, end_ms: 5000 },
      { start_ms: 9000, end_ms: 12_000 },
    ], 20_000);

    expect(out.every((w) => w.start_ms === 2000 && w.end_ms === 12_000)).toBe(true);
  });

  it("falls back to the whole file when there are no segments", () => {
    const out = anchorTimelessWords([word("a")], [], 8000);
    expect(out[0]).toMatchObject({ start_ms: 0, end_ms: 8000 });
  });

  it("never produces a zero-length span for audio with duration", () => {
    // The whole point: NOT NULL columns downstream would accept 0–0 happily,
    // and nothing would ever tell us the timing was meaningless.
    const degenerate = anchorTimelessWords([word("a")], [{ start_ms: 4000, end_ms: 4000 }], 10_000);
    expect(degenerate[0]!.end_ms).toBeGreaterThan(degenerate[0]!.start_ms);
  });

  it("keeps the text and speaker it was given", () => {
    const w = { ...word("سلام"), speaker: "S1", channel: 1 };
    const [out] = anchorTimelessWords([w], [{ start_ms: 0, end_ms: 1000 }], 1000);
    expect(out).toMatchObject({ text: "سلام", speaker: "S1", channel: 1 });
  });

  it("returns nothing for no words rather than one empty span", () => {
    expect(anchorTimelessWords([], [{ start_ms: 0, end_ms: 1000 }], 1000)).toEqual([]);
  });
});
