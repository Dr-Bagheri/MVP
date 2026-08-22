/**
 * M39 voice matching — the PURE halves. The model half runs in ml/'s
 * embedding-live smoke at acceptance; here the selection and the decision
 * are pinned, both directions each (a matcher that can only say yes names
 * strangers; one that can only say no is dead weight).
 */
import { describe, expect, it } from "vitest";

import { cosine, decideMatch, pickSpeechRanges } from "../src/worker/voice-match.ts";

const P1 = { id: "p1", offset_ms: 0, storage_bucket: "b", storage_path: "a/0.webm" };
const P2 = { id: "p2", offset_ms: 600_000, storage_bucket: "b", storage_path: "a/1.webm" };

describe("pickSpeechRanges", () => {
  it("picks the ONE part where the speaker spoke most, ranges part-relative", () => {
    const pick = pickSpeechRanges(
      [
        { part_id: "p1", start_ms: 1_000, end_ms: 4_000, call_speaker_id: "s1" },
        { part_id: "p2", start_ms: 601_000, end_ms: 611_000, call_speaker_id: "s1" },
        { part_id: "p2", start_ms: 620_000, end_ms: 625_000, call_speaker_id: "s1" },
      ],
      [P1, P2], "s1", 60_000,
    );
    expect(pick?.part.id).toBe("p2");
    // 601_000 absolute − 600_000 part offset = 1_000 in the FILE — the
    // factor that, wrong, embeds someone else's voice
    expect(pick?.ranges).toEqual([
      { start_ms: 1_000, end_ms: 11_000 },
      { start_ms: 20_000, end_ms: 25_000 },
    ]);
    expect(pick?.speechMs).toBe(15_000);
  });

  it("caps the material and keeps the LONGEST segments", () => {
    const pick = pickSpeechRanges(
      [
        { part_id: "p1", start_ms: 0, end_ms: 40_000, call_speaker_id: "s1" },
        { part_id: "p1", start_ms: 50_000, end_ms: 90_000, call_speaker_id: "s1" },
        { part_id: "p1", start_ms: 100_000, end_ms: 101_000, call_speaker_id: "s1" },
      ],
      [P1], "s1", 60_000,
    );
    // two 40s segments hit the 60s cap; the 1s scrap never joins
    expect(pick?.ranges).toHaveLength(2);
    expect(pick?.speechMs).toBe(80_000);
  });

  it("another speaker's segments are never its material", () => {
    const pick = pickSpeechRanges(
      [{ part_id: "p1", start_ms: 0, end_ms: 10_000, call_speaker_id: "OTHER" }],
      [P1], "s1", 60_000,
    );
    expect(pick).toBeNull();
  });

  it("a part whose audio is GONE (purged object) yields nothing, not a broken URL", () => {
    const gone = { ...P1, storage_path: null };
    const pick = pickSpeechRanges(
      [{ part_id: "p1", start_ms: 0, end_ms: 10_000, call_speaker_id: "s1" }],
      [gone], "s1", 60_000,
    );
    expect(pick).toBeNull();
  });
});

describe("decideMatch", () => {
  const ENROLLED = [
    { person_id: "alice", vector: [1, 0, 0] },
    { person_id: "bob", vector: [0, 1, 0] },
  ];

  it("links the clear winner", () => {
    const v = decideMatch([0.95, 0.05, 0], ENROLLED, 0.6, 0.1);
    expect(v).toMatchObject({ person_id: "alice" });
  });

  it("says WHICH nothing: below threshold", () => {
    const v = decideMatch([0.4, 0.3, 0.86], ENROLLED, 0.6, 0.1);
    expect(v).toMatchObject({ person_id: null, why: "below_threshold" });
  });

  it("says WHICH nothing: two candidates too close — a coin flip is not a name", () => {
    const v = decideMatch([0.7, 0.68, 0], ENROLLED, 0.6, 0.1);
    expect(v).toMatchObject({ person_id: null, why: "ambiguous" });
  });

  it("says WHICH nothing: nobody enrolled", () => {
    expect(decideMatch([1, 0, 0], [], 0.6, 0.1)).toMatchObject({
      person_id: null, why: "no_enrolled_prints",
    });
  });

  it("ONE enrolled print still links (margin compares against -1, not a missing runner-up)", () => {
    const v = decideMatch([1, 0, 0], [ENROLLED[0]!], 0.6, 0.1);
    expect(v).toMatchObject({ person_id: "alice" });
  });
});

describe("cosine", () => {
  it("degenerate inputs are 0, never NaN — NaN < threshold is silently 'no match' forever", () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});
