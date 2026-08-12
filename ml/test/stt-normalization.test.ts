import { describe, expect, it } from "vitest";
import { toResult } from "../src/stt/soniox.js";
import { splitWords } from "../src/stt/openrouter.js";

describe("soniox tokens → words", () => {
  it("rebuilds a word split across sub-word tokens", () => {
    // Soniox emits sub-words; leading whitespace marks a real word boundary.
    // "کتاب" must not reach the transcript as "کت" + "اب".
    const { words } = toResult(
      [
        { text: "کت", start_ms: 100, end_ms: 200, confidence: 0.9 },
        { text: "اب", start_ms: 200, end_ms: 320, confidence: 0.8 },
        { text: " خوب", start_ms: 400, end_ms: 700, confidence: 0.95 },
      ],
      false,
    );

    expect(words.map((w) => w.text)).toEqual(["کتاب", "خوب"]);
    expect(words[0]).toMatchObject({ start_ms: 100, end_ms: 320 });
    // Confidence of a rebuilt word is its weakest piece, not its strongest.
    expect(words[0]!.confidence).toBeCloseTo(0.8);
  });

  it("numbers speakers by first appearance and never by provider id", () => {
    const { words, diarized } = toResult(
      [
        { text: "سلام", start_ms: 0, end_ms: 300, speaker: 7 },
        { text: " درود", start_ms: 400, end_ms: 800, speaker: 3 },
        { text: " بله", start_ms: 900, end_ms: 1100, speaker: 7 },
      ],
      true,
    );

    expect(words.map((w) => w.speaker)).toEqual(["S1", "S2", "S1"]);
    expect(diarized).toBe(true);
  });

  it("breaks a word when the speaker changes mid-token-run", () => {
    // One word cannot belong to two voices.
    const { words } = toResult(
      [
        { text: "بله", start_ms: 0, end_ms: 200, speaker: 1 },
        { text: "خیر", start_ms: 200, end_ms: 400, speaker: 2 },
      ],
      true,
    );
    expect(words).toHaveLength(2);
    expect(words.map((w) => w.speaker)).toEqual(["S1", "S2"]);
  });

  it("drops speakers entirely when diarization was not asked for", () => {
    const { words, diarized } = toResult([{ text: "سلام", start_ms: 0, end_ms: 1, speaker: 4 }], false);
    expect(words[0]!.speaker).toBeNull();
    expect(diarized).toBe(false);
  });

  it("reports the dominant language and always word granularity", () => {
    const res = toResult(
      [
        { text: "سلام", start_ms: 0, end_ms: 1, language: "fa" },
        { text: " خوب", start_ms: 2, end_ms: 3, language: "fa" },
        { text: " ok", start_ms: 4, end_ms: 5, language: "en" },
      ],
      false,
    );
    expect(res.language).toBe("fa");
    expect(res.timestamps).toBe("word");
  });

  it("ignores empty tokens", () => {
    const { words } = toResult([{ text: "" }, { text: "سلام", start_ms: 0, end_ms: 100 }], false);
    expect(words).toHaveLength(1);
  });

  it("treats a whitespace-only token as a word boundary, not as noise", () => {
    // Regression, found on the first live run: dropping the separator token
    // glued "figures" and "right" into "figuresright". A standalone space IS
    // the boundary — it carries the information, so it cannot be discarded.
    const { words } = toResult(
      [
        { text: "figures", start_ms: 0, end_ms: 300 },
        { text: " ", start_ms: 300, end_ms: 310 },
        { text: "right", start_ms: 310, end_ms: 600 },
      ],
      false,
    );
    expect(words.map((w) => w.text)).toEqual(["figures", "right"]);
  });

  it("still merges genuine sub-words across a boundary-free run", () => {
    const { words } = toResult(
      [
        { text: "کت", start_ms: 0, end_ms: 100 },
        { text: "اب", start_ms: 100, end_ms: 200 },
      ],
      false,
    );
    expect(words.map((w) => w.text)).toEqual(["کتاب"]);
  });
});

describe("openrouter text → words", () => {
  it("gives every word the span of the audio, and invents no timing", () => {
    const words = splitWords("سلام حال شما چطور است", 8000);
    expect(words).toHaveLength(5);
    // Every word carries the same span: that is the honest answer when the
    // lane returned no timings at all. Spreading them evenly would look like
    // data and be fiction.
    expect(new Set(words.map((w) => `${w.start_ms}-${w.end_ms}`)).size).toBe(1);
    expect(words[0]).toMatchObject({ start_ms: 0, end_ms: 8000, confidence: null, speaker: null });
  });

  it("returns nothing for an empty transcript", () => {
    expect(splitWords("", 1000)).toEqual([]);
    expect(splitWords("   ", 1000)).toEqual([]);
  });
});
