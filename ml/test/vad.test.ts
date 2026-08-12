import { describe, expect, it } from "vitest";
import { EnergyVad } from "../src/vad/energy.js";
import { probsToSegments } from "../src/vad/types.js";
import { concat, silence, tone, SR } from "./helpers.js";

const pcm = (samples: Float32Array) => ({
  samples,
  sampleRate: SR,
  channels: 1,
  durationMs: Math.round((samples.length / SR) * 1000),
});

describe("energy VAD", () => {
  it("finds the speech and leaves the silence out", async () => {
    // 2s tone · 4s silence · 2s tone — the shape of a real pause.
    const audio = concat(tone(220, 2000), silence(4000), tone(330, 2000));
    const segments = await new EnergyVad().detect(pcm(audio));

    expect(segments).toHaveLength(2);
    // Padding widens each region by 150ms, so assert the neighbourhood.
    expect(segments[0]!.start_ms).toBeLessThan(200);
    expect(segments[0]!.end_ms).toBeGreaterThan(1800);
    expect(segments[0]!.end_ms).toBeLessThan(2400);
    expect(segments[1]!.start_ms).toBeGreaterThan(5800);
  });

  it("trims enough of a mostly-silent file to be worth the call", async () => {
    const audio = concat(silence(8000), tone(300, 2000), silence(8000));
    const segments = await new EnergyVad().detect(pcm(audio));
    const speech = segments.reduce((a, s) => a + (s.end_ms - s.start_ms), 0);

    expect(speech).toBeLessThan(3000); // 18s in, under 3s paid for
    expect(speech).toBeGreaterThan(1500);
  });

  it("returns nothing for pure silence rather than guessing", async () => {
    expect(await new EnergyVad().detect(pcm(silence(5000)))).toHaveLength(0);
  });

  it("keeps continuous speech as one region", async () => {
    const segments = await new EnergyVad().detect(pcm(tone(250, 6000)));
    expect(segments).toHaveLength(1);
  });
});

describe("probsToSegments", () => {
  const opts = { frameMs: 100, minSpeechMs: 250, minSilenceMs: 400, padMs: 0, durationMs: 10_000 };

  it("bridges a breath but not a pause", () => {
    // speech(500) · gap(200) · speech(500)  → one region: the gap is a breath
    const probs = [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1];
    expect(probsToSegments(probs, 0.5, opts)).toEqual([{ start_ms: 0, end_ms: 1200 }]);
  });

  it("splits on a real pause", () => {
    // speech(500) · gap(600) · speech(500)
    const probs = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    expect(probsToSegments(probs, 0.5, opts)).toHaveLength(2);
  });

  it("drops a click too short to be an utterance", () => {
    const probs = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(probsToSegments(probs, 0.5, opts)).toHaveLength(0);
  });

  it("bridges before it filters, so a broken word survives", () => {
    // Two 200ms fragments split by a 100ms gap: each is under minSpeechMs
    // alone, but together they are a 500ms utterance. Filtering first would
    // throw away real speech.
    const probs = [1, 1, 0, 1, 1, 1];
    expect(probsToSegments(probs, 0.5, opts)).toEqual([{ start_ms: 0, end_ms: 600 }]);
  });

  it("pads outward without running past the file", () => {
    const padded = probsToSegments([1, 1, 1, 1, 1], 0.5, { ...opts, padMs: 200, durationMs: 500 });
    expect(padded).toEqual([{ start_ms: 0, end_ms: 500 }]);
  });
});
