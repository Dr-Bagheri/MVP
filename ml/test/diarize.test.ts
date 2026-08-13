import { describe, expect, it } from "vitest";
import { assignSpeakers } from "../src/diarize/types.js";
import { normalize } from "../src/diarize/sherpa.js";
import type { SttWord } from "../src/stt/types.js";

const word = (text: string, start_ms: number, end_ms: number): SttWord => ({
  text,
  start_ms,
  end_ms,
  confidence: null,
  speaker: null,
  language: null,
});

describe("assignSpeakers", () => {
  const segments = [
    { start_ms: 0, end_ms: 5000, speaker: "S1" },
    { start_ms: 5000, end_ms: 10_000, speaker: "S2" },
  ];

  it("gives a word to the speaker who covers most of it", () => {
    const out = assignSpeakers(
      [word("aa", 1000, 2000), word("bb", 6000, 7000), word("cc", 4800, 5600)],
      segments,
    );
    expect(out.map((w) => w.speaker)).toEqual(["S1", "S2", "S2"]);
  });

  it("leaves a word unlabeled rather than guessing", () => {
    // Diarization found nobody there; an unlabeled word is honest.
    const out = assignSpeakers([word("zz", 20_000, 21_000)], segments);
    expect(out[0]!.speaker).toBeNull();
  });

  it("labels a zero-length word by the instant it sits in", () => {
    const out = assignSpeakers([word("x", 6000, 6000)], segments);
    expect(out[0]!.speaker).toBe("S2");
  });

  it("passes words through untouched when there is no diarization", () => {
    const words = [word("aa", 0, 100)];
    expect(assignSpeakers(words, [])[0]!.speaker).toBeNull();
  });

  it("does not mutate the words it was given", () => {
    const words = [word("aa", 1000, 2000)];
    assignSpeakers(words, segments);
    expect(words[0]!.speaker).toBeNull();
  });
});

describe("sherpa segment normalization", () => {
  it("converts seconds to ms and numbers speakers by first appearance", () => {
    const { segments: out } = normalize(
      [
        { start: 2.5, end: 4.0, speaker: 3 },
        { start: 0.0, end: 2.0, speaker: 1 },
      ],
      8,
    );
    expect(out).toEqual([
      { start_ms: 0, end_ms: 2000, speaker: "S1" },
      { start_ms: 2500, end_ms: 4000, speaker: "S2" },
    ]);
  });

  it("KEEPS every segment when the clusterer exceeds max_speakers", () => {
    // Measured on a real two-voice Persian recording: the clusterer found 15+
    // at every threshold from 0.5 to 0.9. Dropping the overflow deleted a
    // person's speech to satisfy a config number — invisible except as a
    // speech total that moved when the threshold changed (M21 inverted).
    const raw = [0, 1, 2, 3].map((s) => ({ start: s, end: s + 0.5, speaker: s }));
    const { segments, speakersFound, exceededMax } = normalize(raw, 2);

    expect(segments).toHaveLength(4);
    expect(speakersFound).toBe(4);
    expect(exceededMax).toBe(true);
  });

  it("reports no overflow when the count fits", () => {
    const raw = [0, 1].map((s) => ({ start: s, end: s + 0.5, speaker: s }));
    expect(normalize(raw, 8)).toMatchObject({ speakersFound: 2, exceededMax: false });
  });
});
