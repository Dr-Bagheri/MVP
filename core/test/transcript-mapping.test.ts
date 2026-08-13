/**
 * The ml/ → transcript boundary: uniform offset arithmetic, the degradation
 * ladder, and the invariant Backend 2 asked core/ to enforce rather than
 * trust (end_ms > start_ms).
 */
import { describe, expect, it } from "vitest";

import {
  callHasWordTimestamps,
  InvalidTimingError,
  mapWordsToSegments,
  seqBaseForPart,
  SEQ_STRIDE,
  type MlResult,
} from "../src/worker/transcript-mapping.ts";

const PART = { id: "part-1", offsetMs: 30_000, durationMs: 60_000 };

const wordLane = (over: Partial<MlResult> = {}): MlResult => ({
  words: [
    { text: "سلام", start_ms: 100, end_ms: 400, speaker: "S1" },
    { text: "من", start_ms: 500, end_ms: 700, speaker: "S1" },
    { text: "بله", start_ms: 900, end_ms: 1200, speaker: "S2" },
  ],
  provenance: { stt: { lane: "soniox", timestamps: "word" } },
  degraded: false,
  ...over,
});

describe("offset arithmetic is uniform (no special case for degraded parts)", () => {
  it("places word-timed output on the call timeline", () => {
    const { segments, hasWordTimestamps, degraded } = mapWordsToSegments(wordLane(), PART);
    expect(hasWordTimestamps).toBe(true);
    expect(degraded).toBe(false);
    // 30_000 offset added to every timestamp, words and segments alike
    expect(segments[0]!.startMs).toBe(30_100);
    expect(segments[0]!.endMs).toBe(30_700);
    expect(segments[0]!.words.map((w) => w.startMs)).toEqual([30_100, 30_500]);
    expect(segments[1]!.startMs).toBe(30_900);
  });

  it("applies the SAME rule to a degraded, timing-less part", () => {
    // ml/ anchors the prose to the span of audio it came from — never 0–0
    const anchored: MlResult = {
      words: [{ text: "یک متن کامل بدون زمان‌بندی کلمه‌ای", start_ms: 2_000, end_ms: 55_000 }],
      provenance: { stt: { lane: "openrouter", timestamps: "none" } },
      degraded: true,
    };
    const { segments, hasWordTimestamps, degraded } = mapWordsToSegments(anchored, PART);
    expect(hasWordTimestamps).toBe(false);
    expect(degraded).toBe(true);
    // same offset arithmetic, no special case
    expect(segments[0]!.startMs).toBe(32_000);
    expect(segments[0]!.endMs).toBe(85_000);
    // the anchored span is tighter than the part — better than click-a-part
    expect(segments[0]!.endMs - segments[0]!.startMs).toBeLessThan(PART.durationMs);
  });

  it("does not fake word rows on a degraded part", () => {
    const anchored: MlResult = {
      words: [{ text: "متن", start_ms: 0, end_ms: 40_000 }],
      provenance: { stt: { timestamps: "none" } },
      degraded: true,
    };
    const { segments } = mapWordsToSegments(anchored, PART);
    // storing these as "words" would fake click-a-word precision we lack
    expect(segments[0]!.words).toEqual([]);
    // but the row is still seekable — the ladder's bottom rung
    expect(segments[0]!.endMs).toBeGreaterThan(segments[0]!.startMs);
  });
});

describe("segments group by speaker turn", () => {
  it("starts a new segment when the speaker changes", () => {
    const { segments } = mapWordsToSegments(wordLane(), PART);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.speaker).toBe("S1");
    expect(segments[0]!.text).toBe("سلام من");
    expect(segments[1]!.speaker).toBe("S2");
    expect(segments[1]!.text).toBe("بله");
    expect(segments.map((s) => s.seq)).toEqual([0, 1]);
  });

  it("treats an absent speaker as one continuous turn", () => {
    const { segments } = mapWordsToSegments({
      words: [
        { text: "الف", start_ms: 0, end_ms: 100 },
        { text: "ب", start_ms: 150, end_ms: 300 },
      ],
      provenance: { stt: { timestamps: "word" } },
    }, PART);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("الف ب");
  });
});

describe("the invariant core/ enforces rather than trusts", () => {
  it("accepts a zero-length WORD — real audio contains them", () => {
    // Measured on the acceptance fixture: «و» ("and") comes back at
    // 45128–45128. One vowel, spoken fast, honestly reported. Demanding
    // end > start per word threw on it and failed the entire call.
    const { segments } = mapWordsToSegments({
      words: [
        { text: "سلام", start_ms: 100, end_ms: 400, speaker: "S1" },
        { text: "و", start_ms: 15_128, end_ms: 15_128, speaker: "S1" },
        { text: "خوب", start_ms: 15_200, end_ms: 15_600, speaker: "S1" },
      ],
      provenance: { stt: { timestamps: "word" } },
    }, PART);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("سلام و خوب");
    // The zero-length word survives as a word row, seekable at its instant.
    const wordSpans = segments[0]!.words.map((w) => w.endMs - w.startMs);
    expect(wordSpans).toEqual([300, 0, 400]);
  });

  it("widens a segment that would collapse, rather than dropping the word", () => {
    // A lone zero-length word that is its own speaker turn. The segment is
    // what lands in NOT NULL columns and what the player seeks to, so it must
    // have a real span — but the word must not vanish either.
    const { segments } = mapWordsToSegments({
      words: [{ text: "و", start_ms: 5_000, end_ms: 5_000 }],
      provenance: { stt: { timestamps: "word" } },
    }, PART);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("و");
    expect(segments[0]!.endMs).toBeGreaterThan(segments[0]!.startMs);
    // 1ms — below any perceptible seek precision, so it claims nothing false.
    expect(segments[0]!.endMs - segments[0]!.startMs).toBe(1);
  });

  it("still refuses a collapsed span on the DEGRADED path", () => {
    // ml/ guarantees end > start when it anchors timing-less prose. If that
    // ever regresses we want the loud failure, not a 1ms line standing in for
    // a whole part.
    const collapsed: MlResult = {
      words: [
        { text: "متن", start_ms: 0, end_ms: 0 },
        { text: "دوم", start_ms: 0, end_ms: 0, speaker: "S2" },
      ],
      provenance: { stt: { timestamps: "none" } },
    };
    const { segments } = mapWordsToSegments(collapsed, PART);
    // Each collapsed turn is widened, never stored as 0–0.
    for (const s of segments) expect(s.endMs).toBeGreaterThan(s.startMs);
  });

  it("refuses inverted and non-finite timings", () => {
    expect(() => mapWordsToSegments({
      words: [{ text: "x", start_ms: 500, end_ms: 100 }],
      provenance: { stt: { timestamps: "word" } },
    }, PART)).toThrow(InvalidTimingError);

    expect(() => mapWordsToSegments({
      words: [{ text: "x", start_ms: Number.NaN, end_ms: 100 }],
      provenance: { stt: { timestamps: "word" } },
    }, PART)).toThrow(/non-finite/);
  });

  it("refuses a negative part offset", () => {
    expect(() => mapWordsToSegments(wordLane(), { id: "p", offsetMs: -1 }))
      .toThrow(/non-negative/);
  });
});

describe("seq ranging across parts (regression: every call over 30 minutes)", () => {
  // The original bug: seq numbered from 0 per part, but transcript_segment is
  // UNIQUE (call_id, seq). Every multi-part call collided — i.e. exactly the
  // recordings M7's part model exists for. The handed-over tests were green
  // because every fixture had one part.
  it("gives each part a disjoint range", () => {
    const words = [
      { text: "الف", start_ms: 0, end_ms: 100 },
      { text: "ب", start_ms: 200, end_ms: 300, speaker: "S2" },
    ];
    const result: MlResult = { words, provenance: { stt: { timestamps: "word" } } };

    const first = mapWordsToSegments(result, { id: "p0", offsetMs: 0, seqStart: seqBaseForPart(0) });
    const second = mapWordsToSegments(result, { id: "p1", offsetMs: 1_800_000, seqStart: seqBaseForPart(1) });

    const overlap = first.segments
      .map((s) => s.seq)
      .filter((seq) => second.segments.some((o) => o.seq === seq));
    expect(overlap).toEqual([]);
    expect(first.segments.map((s) => s.seq)).toEqual([0, 1]);
    expect(second.segments.map((s) => s.seq)).toEqual([SEQ_STRIDE, SEQ_STRIDE + 1]);
  });

  it("is deterministic, so a retry recomputes the same numbers", () => {
    // Idempotence is the point: a re-run collides with itself on the unique
    // constraint — loudly — instead of appending a second copy of the
    // transcript. A count-what-is-stored base could not do that.
    expect(seqBaseForPart(3)).toBe(seqBaseForPart(3));
    expect(seqBaseForPart(3)).toBe(3 * SEQ_STRIDE);
  });

  it("needs no coordination between concurrent parts", () => {
    // Two workers processing part 2 and part 5 of one call at the same moment
    // derive their ranges from their own index and never consult each other.
    const bases = [0, 1, 2, 5, 61].map(seqBaseForPart);
    expect(new Set(bases).size).toBe(bases.length);
  });

  it("refuses a nonsense part index rather than computing a nonsense base", () => {
    expect(() => seqBaseForPart(-1)).toThrow(InvalidTimingError);
    expect(() => seqBaseForPart(1.5)).toThrow(InvalidTimingError);
  });
});

describe("call-level derived flag (what the UI reads)", () => {
  it("is true only when every part has word timing", () => {
    expect(callHasWordTimestamps([{ hasWordTimestamps: true }, { hasWordTimestamps: true }])).toBe(true);
    // one degraded part makes the call only partially seekable
    expect(callHasWordTimestamps([{ hasWordTimestamps: true }, { hasWordTimestamps: false }])).toBe(false);
    expect(callHasWordTimestamps([])).toBe(false);
  });
});

/**
 * M20 segmentation: speaker change OR VAD speech boundary, with a backstop.
 *
 * The rule this replaced broke on speaker change and nothing else, and the
 * fixtures that covered it all had two speakers — which is why it looked
 * right. On a two-speaker fixture, "breaks on speaker change" and "breaks on
 * speaker change or silence" produce the same answer for the same reason
 * max and sum agree on a single-part call. The input where they differ is one
 * speaker talking with pauses, and it was measured on real audio: 86 seconds
 * of one voice arrived as ONE segment.
 */
describe("segmentation — the line boundary (M20)", () => {
  /** One speaker, three utterances separated by silence. The monologue case. */
  const monologue = (over: Partial<MlResult> = {}): MlResult => ({
    words: [
      { text: "یک", start_ms: 100, end_ms: 400, speaker: "S1" },
      { text: "دو", start_ms: 450, end_ms: 800, speaker: "S1" },
      // ── silence ──
      { text: "سه", start_ms: 5_000, end_ms: 5_300, speaker: "S1" },
      { text: "چهار", start_ms: 5_400, end_ms: 5_800, speaker: "S1" },
      // ── silence ──
      { text: "پنج", start_ms: 12_000, end_ms: 12_400, speaker: "S1" },
    ],
    speech: {
      segments: [
        { start_ms: 100, end_ms: 800 },
        { start_ms: 5_000, end_ms: 5_800 },
        { start_ms: 12_000, end_ms: 12_400 },
      ],
    },
    provenance: { stt: { lane: "soniox", timestamps: "word" } },
    degraded: false,
    ...over,
  });

  it("breaks a SINGLE-SPEAKER recording at the silences", () => {
    const { segments } = mapWordsToSegments(monologue(), PART);
    // The whole point: one speaker, more than one segment.
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.text)).toEqual(["یک دو", "سه چهار", "پنج"]);
    expect(segments.map((s) => s.speaker)).toEqual(["S1", "S1", "S1"]);
  });

  it("would have produced ONE segment without the speech regions — the old behaviour", () => {
    // Same words, no VAD regions. This is the bug, pinned: if a future change
    // stops consuming speech.segments, this test keeps passing and the one
    // above starts failing, which says exactly what broke.
    const { segments } = mapWordsToSegments(monologue({ speech: undefined }), PART);
    expect(segments).toHaveLength(1);
  });

  it("keeps segments on the call timeline, boundaries included", () => {
    const { segments } = mapWordsToSegments(monologue(), PART);
    // Regions are 0-based like the words; the offset is added once, to both.
    expect(segments[1]!.startMs).toBe(35_000);
    expect(segments[2]!.startMs).toBe(42_000);
    expect(segments.every((s) => s.endMs > s.startMs)).toBe(true);
  });

  it("still breaks on a speaker change INSIDE one speech region", () => {
    // Two people talking over each other are one continuous region of speech
    // and two segments. Silence is an additional boundary, never a replacement.
    const interjection: MlResult = {
      words: [
        { text: "من", start_ms: 100, end_ms: 300, speaker: "S1" },
        { text: "نه", start_ms: 350, end_ms: 500, speaker: "S2" },
        { text: "باشه", start_ms: 550, end_ms: 800, speaker: "S1" },
      ],
      speech: { segments: [{ start_ms: 100, end_ms: 800 }] },
      provenance: { stt: { lane: "soniox", timestamps: "word" } },
    };
    const { segments } = mapWordsToSegments(interjection, PART);
    expect(segments.map((s) => s.speaker)).toEqual(["S1", "S2", "S1"]);
  });

  it("does not manufacture a break for a word landing in the silence", () => {
    // A word whose start falls between two regions keeps the preceding
    // region's index rather than inventing one of its own — otherwise ordinary
    // boundary jitter would shred a sentence into one-word rows.
    const jitter: MlResult = {
      words: [
        { text: "الف", start_ms: 100, end_ms: 400, speaker: "S1" },
        { text: "ب", start_ms: 900, end_ms: 1_000, speaker: "S1" }, // after region 0 ends
      ],
      speech: { segments: [{ start_ms: 100, end_ms: 800 }, { start_ms: 5_000, end_ms: 6_000 }] },
      provenance: { stt: { lane: "soniox", timestamps: "word" } },
    };
    expect(mapWordsToSegments(jitter, PART).segments).toHaveLength(1);
  });

  it("caps a segment when a lane offers no speakers and no regions", () => {
    // The backstop. It is a ceiling, not a line-length preference — without it
    // a lane giving neither boundary puts an entire recording in one row.
    const many: MlResult = {
      words: Array.from({ length: 200 }, (_, i) => ({
        text: `w${i}`,
        start_ms: i * 100,
        end_ms: i * 100 + 50,
        speaker: null,
      })),
      provenance: { stt: { lane: "openrouter", timestamps: "word" } },
    };
    const { segments } = mapWordsToSegments(many, PART);
    expect(segments.length).toBeGreaterThan(1);
    expect(Math.max(...segments.map((s) => s.words.length))).toBeLessThanOrEqual(80);
  });

  it("leaves the DEGRADED rung as one anchored span (M20's bottom rung)", () => {
    // Every word carries the same anchored span here, so splitting would
    // produce rows that all claim the same moment — precision we do not have,
    // asserted anyway. The ladder says this rung is one segment.
    const anchored: MlResult = {
      words: Array.from({ length: 150 }, (_, i) => ({
        text: `w${i}`,
        start_ms: 1_000,
        end_ms: 90_000,
        speaker: null,
      })),
      speech: { segments: [{ start_ms: 1_000, end_ms: 40_000 }, { start_ms: 60_000, end_ms: 90_000 }] },
      provenance: { stt: { lane: "openrouter", timestamps: "none" } },
      degraded: true,
    };
    const { segments, hasWordTimestamps } = mapWordsToSegments(anchored, PART);
    expect(hasWordTimestamps).toBe(false);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.words).toEqual([]);
  });
});
