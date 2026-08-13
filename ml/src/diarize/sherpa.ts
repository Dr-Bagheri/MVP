// Local diarization via sherpa-onnx (M6: diarization stays local, ONNX on CPU,
// whole-file clustering with a tunable threshold).
//
// STATUS: Phase-0 spike PASSED (Backend 1) — sherpa-onnx-node ships a prebuilt
// native binding, so there is no node-gyp, no Python, and no build toolchain
// on any platform we target. The Python escape hatch of M1/M9 stays documented
// and unused: sherpa-onnx is a thin binding over the same ONNX models a Python
// pyannote would run, so switching languages would buy nothing on quality.
//
// The import stays dynamic and `available()` still answers false when the
// models are missing: a diarizer is not needed for two-channel audio, nor on a
// lane that diarizes for us (Soniox does), so its absence degrades one path
// rather than failing startup.
//
// Models (set both, or the diarizer stays unavailable):
//   ML_SEGMENTATION_MODEL — pyannote segmentation ONNX (5.7 MB)
//   ML_EMBEDDING_MODEL    — speaker embedding ONNX (37.8 MB)
//
// CAVEAT carried from the spike, worth keeping in view: its ground truth was
// clean synthetic TTS — two maximally distinct voices, strict alternation, no
// overlap. Perfect scores there prove the plumbing and the clustering, NOT
// real-meeting robustness.
//
// Since measured on real audio (test/smoke/diarizer-threshold.ts): the
// clustering threshold the spike validated was wrong by a factor of five on a
// real conversation, and the default moved 0.5 → 1.0 as a result. At 1.0 the
// count is right within one on a 4-person recording and exactly 1 on a
// single-speaker recording.
//
// Still NOT measured: far-field noise and same-gender voices. Crosstalk HAS
// now been measured (test/smoke/crosstalk.ts) and it is a real bound —
// roughly a third of the words are lost when two people speak at once, with
// nothing in the response saying so.

import { access } from "node:fs/promises";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import { readWav } from "../audio/wav.js";
import { logger } from "../log.js";
import type { DiarSegment, Diarizer } from "./types.js";

export class SherpaDiarizer implements Diarizer {
  readonly name = "sherpa-onnx";
  private impl: any | undefined;

  async available(): Promise<boolean> {
    const cfg = config();
    if (!cfg.ML_SEGMENTATION_MODEL || !cfg.ML_EMBEDDING_MODEL) return false;
    try {
      await access(cfg.ML_SEGMENTATION_MODEL);
      await access(cfg.ML_EMBEDDING_MODEL);
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  private async load(): Promise<any> {
    if (this.impl) return this.impl;
    // Dynamic and untyped on purpose: the models are optional, and a static
    // import would tie startup to a native binding one deployment may not need.
    const mod: any = await import(/* @vite-ignore */ "sherpa-onnx-node" as string);
    // The package is CommonJS, so under `await import()` its exports land on
    // `.default` — only `OnlineRecognizer` gets hoisted as a named export by
    // Node's CJS-detection heuristic, which makes the namespace look usable
    // right up until you construct something from it.
    this.impl = mod.default?.OfflineSpeakerDiarization ? mod.default : mod;
    if (!this.impl?.OfflineSpeakerDiarization) {
      throw new Error("sherpa-onnx-node exposes no OfflineSpeakerDiarization");
    }
    return this.impl;
  }

  async diarize(file: string, opts: { maxSpeakers: number }): Promise<DiarSegment[]> {
    const cfg = config();
    let sherpa: any;
    try {
      sherpa = await this.load();
    } catch (e) {
      throw new MlError("diarization_failed", "sherpa-onnx-node is not installed", { cause: e });
    }

    const pcm = await readWav(file);

    try {
      const sd = new sherpa.OfflineSpeakerDiarization({
        segmentation: { pyannote: { model: cfg.ML_SEGMENTATION_MODEL }, debug: 0 },
        embedding: { model: cfg.ML_EMBEDDING_MODEL, debug: 0, numThreads: cfg.ML_DIARIZER_THREADS },
        clustering: {
          // -1 = discover the count. The spike verified this finds exactly the
          // right number of speakers without being told — identical output to
          // pinning the count — and on single-speaker Persian audio it did not
          // invent a second voice. Fixing the count would be a guess we have
          // no right to make about someone's recording.
          numClusters: -1,
          threshold: cfg.ML_DIARIZER_THRESHOLD,
        },
        minDurationOn: 0.3,
        minDurationOff: 0.5,
      });

      const raw = sd.process(pcm.samples) as Array<{ start: number; end: number; speaker: number }>;
      const { segments, speakersFound, exceededMax } = normalize(raw, opts.maxSpeakers);

      if (exceededMax) {
        // Said out loud rather than trimmed away.
        //
        // The over-split this was written for turned out to be a mis-set
        // threshold, not a property of the clusterer (see config.ts: the
        // default moved 0.5 → 1.0 on measurement, and the "two-voice"
        // recording it was measured against is actually a FOUR-person
        // conversation — the old ground truth came from the file's name).
        // The warning stays regardless: a real recording can still exceed a
        // caller's hint, and the honest response to that is a visible warning
        // rather than a quietly shorter transcript.
        logger.warn(
          { speakers_found: speakersFound, max_speakers: opts.maxSpeakers },
          "diarizer found more speakers than max_speakers; keeping every segment",
        );
      }
      return segments;
    } catch (e) {
      throw new MlError("diarization_failed", "sherpa-onnx diarization failed", { cause: e });
    }
  }
}

export interface NormalizedDiarization {
  segments: DiarSegment[];
  /** Distinct voices the clusterer actually found, before any ceiling. */
  speakersFound: number;
  /** True when that exceeded the caller's `max_speakers` hint. */
  exceededMax: boolean;
}

/**
 * sherpa's seconds + numeric speakers → our ms + S1/S2 labels by first
 * appearance.
 *
 * **Every segment is kept, always.** An earlier version dropped segments whose
 * speaker fell beyond `max_speakers`, which silently deleted speech to satisfy
 * a configuration number — a person's words vanishing from the transcript
 * because the clusterer over-split. That is the forfeit hierarchy inverted
 * (M21: the system may forfeit a derived artifact, never the user's data), and
 * it was invisible: the only symptom was a speech total that moved when a
 * threshold changed.
 *
 * `max_speakers` is therefore a HINT that is reported on, not a knife. When the
 * count exceeds it, the caller is told and decides.
 */
export function normalize(
  raw: readonly { start: number; end: number; speaker: number }[],
  maxSpeakers: number,
): NormalizedDiarization {
  const order = new Map<number, string>();
  const out: DiarSegment[] = [];

  for (const s of [...raw].sort((a, b) => a.start - b.start)) {
    let label = order.get(s.speaker);
    if (!label) {
      label = `S${order.size + 1}`;
      order.set(s.speaker, label);
    }
    out.push({ start_ms: Math.round(s.start * 1000), end_ms: Math.round(s.end * 1000), speaker: label });
  }

  return {
    segments: out,
    speakersFound: order.size,
    exceededMax: order.size > maxSpeakers,
  };
}
