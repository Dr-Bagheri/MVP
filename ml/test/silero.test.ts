// Exercises the real ONNX path when the model is present. Skips itself
// otherwise, so a checkout without models/ still has a green suite — the model
// is git-ignored by design (large binaries do not belong in the repo).

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SileroVad } from "../src/vad/silero.js";
import { concat, silence, tone, SR } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.ML_SILERO_MODEL ?? path.join(here, "..", "models", "silero_vad.onnx");

const suite = existsSync(MODEL) ? describe : describe.skip;

const pcm = (samples: Float32Array) => ({
  samples,
  sampleRate: SR,
  channels: 1,
  durationMs: Math.round((samples.length / SR) * 1000),
});

suite("Silero VAD (ONNX)", () => {
  it("loads and reports which generation it is", async () => {
    const vad = await SileroVad.load(MODEL);
    // The loader adapts to the recurrent-state layout instead of assuming one.
    expect(["silero-vad-v5", "silero-vad-v4"]).toContain(vad.name);
    expect(vad.threshold).toBeGreaterThan(0);
  });

  it("runs the graph across a whole file without a state error", async () => {
    // The recurrent state has to be threaded from window to window; a wrong
    // shape or a dropped hand-off throws here rather than degrading quietly.
    const vad = await SileroVad.load(MODEL);
    await expect(vad.detect(pcm(concat(tone(220, 1000), silence(1000))))).resolves.toBeInstanceOf(Array);
  });

  it("finds no speech in silence", async () => {
    const vad = await SileroVad.load(MODEL);
    expect(await vad.detect(pcm(silence(4000)))).toHaveLength(0);
  });

  it("does not mistake a pure tone for a human voice", async () => {
    // This is the point of a trained VAD over an energy gate: a loud sine is
    // not speech, and the energy fallback cannot tell the difference.
    const vad = await SileroVad.load(MODEL);
    const segments = await vad.detect(pcm(tone(440, 3000, 0.5)));
    const speechMs = segments.reduce((a, s) => a + (s.end_ms - s.start_ms), 0);
    expect(speechMs).toBeLessThan(1000);
  });

  // EVERY assertion above is negative — "finds nothing here" — and a model fed
  // the wrong input shape satisfies all of them. That is not hypothetical: v5
  // silently accepted 512-sample frames (its context dimension is dynamic) and
  // scored real speech at 0.0003 while this suite stayed green.
  //
  // Positive validation needs real speech, which we will not commit as a
  // binary, so it lives in test/smoke/persian-live.ts — the "vad found speech"
  // check. Do not add another negative test here and call the engine covered.
  it("feeds the model the frame size its generation expects", async () => {
    const vad = await SileroVad.load(MODEL);
    // 32ms of audio must yield exactly one probability, whatever the context
    // padding is: a mismatch here means frames and timestamps have desynced.
    const segments = await vad.detect(pcm(concat(silence(2000))));
    expect(segments).toEqual([]);
    expect(vad.name).toBe("silero-vad-v5");
  });
});
