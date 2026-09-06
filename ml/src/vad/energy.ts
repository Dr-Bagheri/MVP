// Fallback VAD: short-time energy against a noise floor estimated from the
// recording itself.
//
// This is NOT as good as Silero and is not pretending to be — it exists so the
// service is functional before the model file lands, and so unit tests need no
// binary asset. Its job is only to keep obvious silence out of a paid STT
// call; when Silero is available (ML_SILERO_MODEL) it wins.

import { asSource, type PcmInput } from "../audio/wav.js";
import type { Segment, VadEngine } from "./types.js";
import { probsToSegments, windows } from "./types.js";

const FRAME_MS = 30;

export class EnergyVad implements VadEngine {
  readonly name = "energy-rms";
  readonly threshold = 0.5;

  /**
   * Frame energies off the stream (2026-09-06); the percentiles need every
   * frame's RMS, which is one number per 30 ms — five hours is six hundred
   * thousand doubles, not the samples themselves.
   */
  async detect(input: PcmInput): Promise<Segment[]> {
    const source = asSource(input);
    const frameLen = Math.max(1, Math.round((source.sampleRate * FRAME_MS) / 1000));

    const energies: number[] = [];
    for await (const frame of windows(source.chunks(), frameLen)) {
      let acc = 0;
      for (let i = 0; i < frameLen; i++) {
        const s = frame[i] ?? 0;
        acc += s * s;
      }
      energies.push(Math.sqrt(acc / frameLen));
    }
    if (energies.length === 0) return [];
    const rms = Float64Array.from(energies);

    // Noise floor = 10th percentile, peak = 95th. Speech has to stand clear of
    // the floor, with an absolute minimum so digital silence never "speaks".
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

    // A file with no dynamic range has no silence to find — someone talking
    // start to finish, or a continuous tone. Comparing it against its own
    // floor would gate the entire recording away, so fall back to an absolute
    // threshold and keep everything audible. Erring toward keeping audio is
    // the only safe direction: dropped speech never comes back.
    const ABSOLUTE_FLOOR = 0.005;
    const dynamic = peak > floor * 3;
    const gate = dynamic
      ? Math.max(floor * 2, floor + (peak - floor) * 0.15, ABSOLUTE_FLOOR)
      : Math.max(ABSOLUTE_FLOOR, peak * 0.3);

    const probs = Array.from(rms, (v) => (v >= gate ? 1 : 0));

    return probsToSegments(probs, this.threshold, {
      frameMs: FRAME_MS,
      minSpeechMs: 250,
      minSilenceMs: 400,
      padMs: 150,
      durationMs: source.durationMs,
    });
  }
}
