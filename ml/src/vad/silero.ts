// Silero VAD (ONNX) via onnxruntime-node — the real engine (M6).
//
// The model file is not vendored in the repo; point ML_SILERO_MODEL at
// silero_vad.onnx. When it is absent or fails to load, the factory in
// ./index.ts falls back to the energy gate rather than failing the job.
//
// Two model generations are in the wild and we accept either: v5 carries one
// recurrent `state` tensor, v4 carries separate `h`/`c`. We adapt off the
// session's declared input names instead of assuming.

import * as ort from "onnxruntime-node";
import type { Pcm } from "../audio/wav.js";
import type { Segment, VadEngine } from "./types.js";
import { probsToSegments } from "./types.js";

const WINDOW = 512; // samples @16k — the window size Silero was trained on
const FRAME_MS = (WINDOW / 16000) * 1000; // 32ms

// v5 does NOT take a bare 512-sample frame: it expects the last 64 samples of
// the previous frame prepended, for 576 in total. The ONNX graph declares that
// dimension as dynamic, so feeding 512 is accepted and returns confident
// nonsense — near-zero speech probability on obvious speech. Measured on real
// audio: median probability 0.0003 without the context, 1.0 with it. v4 has no
// context and takes the frame as-is.
const CONTEXT: Record<"v4" | "v5", number> = { v5: 64, v4: 0 };

export class SileroVad implements VadEngine {
  readonly name: string;
  readonly threshold: number;

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly layout: "v5" | "v4",
    threshold: number,
    version: string,
  ) {
    this.threshold = threshold;
    this.name = version;
  }

  static async load(modelPath: string, threshold = 0.5): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(modelPath);
    const names = new Set(session.inputNames);
    const layout: "v5" | "v4" = names.has("state") ? "v5" : "v4";
    return new SileroVad(session, layout, threshold, layout === "v5" ? "silero-vad-v5" : "silero-vad-v4");
  }

  async detect(pcm: Pcm): Promise<Segment[]> {
    const probs: number[] = [];
    let state = this.zeroState();
    const sr = this.srTensor();

    const ctxLen = CONTEXT[this.layout];
    let context = new Float32Array(ctxLen);
    const frame = new Float32Array(ctxLen + WINDOW);

    for (let off = 0; off + WINDOW <= pcm.samples.length; off += WINDOW) {
      const chunk = pcm.samples.subarray(off, off + WINDOW);
      frame.set(context, 0);
      frame.set(chunk, ctxLen);

      const feeds: Record<string, ort.Tensor> = {
        // Copy: ORT holds the buffer for the duration of the call, and `frame`
        // is reused on the next iteration.
        input: new ort.Tensor("float32", Float32Array.from(frame), [1, ctxLen + WINDOW]),
        sr,
        ...state,
      };
      const out = await this.session.run(feeds);
      probs.push(Number((out["output"]!.data as Float32Array)[0]));
      state = this.nextState(out);

      if (ctxLen > 0) context = Float32Array.from(chunk.subarray(WINDOW - ctxLen));
    }

    return probsToSegments(probs, this.threshold, {
      frameMs: FRAME_MS,
      minSpeechMs: 250,
      minSilenceMs: 400,
      padMs: 150,
      durationMs: pcm.durationMs,
    });
  }

  private zeroState(): Record<string, ort.Tensor> {
    if (this.layout === "v5") {
      return { state: new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]) };
    }
    return {
      h: new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]),
      c: new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]),
    };
  }

  private nextState(out: ort.InferenceSession.OnnxValueMapType): Record<string, ort.Tensor> {
    if (this.layout === "v5") {
      return { state: out["stateN"] as ort.Tensor };
    }
    return { h: out["hn"] as ort.Tensor, c: out["cn"] as ort.Tensor };
  }

  /** Silero declares `sr` as a bare int64; some exports want it shaped [1]. */
  private srTensor(): ort.Tensor {
    return new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
  }
}
