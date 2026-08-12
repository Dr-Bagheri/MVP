// Local diarization via sherpa-onnx (M6: diarization stays local, ONNX on CPU,
// whole-file clustering with a tunable threshold).
//
// STATUS: the Backend session's Phase-0 spike is measuring whether
// sherpa-onnx-node runs diarization end-to-end on Node 22 / Windows. Until
// that lands, this lane is OPTIONAL BY CONSTRUCTION: `sherpa-onnx-node` is not
// a dependency of ml/, the import is dynamic, and `available()` answers false
// when either the package or the model files are missing. If the spike fails,
// the Python escape hatch (M1/M9) implements this same interface instead and
// nothing above this file changes.
//
// Models (set both, or the diarizer stays unavailable):
//   ML_SEGMENTATION_MODEL — pyannote segmentation ONNX
//   ML_EMBEDDING_MODEL    — speaker embedding ONNX

import { access } from "node:fs/promises";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import { readWav } from "../audio/wav.js";
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
    // Dynamic and untyped on purpose: the package is optional until the spike
    // says otherwise, and a static import would make ml/ fail to build without it.
    this.impl = await import(/* @vite-ignore */ "sherpa-onnx-node" as string);
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
        segmentation: { pyannote: { model: cfg.ML_SEGMENTATION_MODEL } },
        embedding: { model: cfg.ML_EMBEDDING_MODEL },
        clustering: {
          // -1 = discover the count; the threshold decides who is who. Fixing
          // the number of speakers would be a guess we have no right to make.
          numClusters: -1,
          threshold: 0.5,
        },
        minDurationOn: 0.3,
        minDurationOff: 0.5,
      });

      const raw = sd.process(pcm.samples) as Array<{ start: number; end: number; speaker: number }>;
      return normalize(raw, opts.maxSpeakers);
    } catch (e) {
      throw new MlError("diarization_failed", "sherpa-onnx diarization failed", { cause: e });
    }
  }
}

/** sherpa's seconds + numeric speakers → our ms + S1/S2 labels by first appearance. */
export function normalize(
  raw: readonly { start: number; end: number; speaker: number }[],
  maxSpeakers: number,
): DiarSegment[] {
  const order = new Map<number, string>();
  const out: DiarSegment[] = [];

  for (const s of [...raw].sort((a, b) => a.start - b.start)) {
    let label = order.get(s.speaker);
    if (!label) {
      if (order.size >= maxSpeakers) continue; // beyond the caller's ceiling
      label = `S${order.size + 1}`;
      order.set(s.speaker, label);
    }
    out.push({ start_ms: Math.round(s.start * 1000), end_ms: Math.round(s.end * 1000), speaker: label });
  }
  return out;
}
