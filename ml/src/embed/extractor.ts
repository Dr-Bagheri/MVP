// Speaker-embedding extraction (voice enrollment, 2026-08-22) — the SAME
// ONNX model the diarizer clusters with (ML_EMBEDDING_MODEL), exposed as its
// own primitive: samples in, one fixed-dimension voice vector out.
//
// Productless on purpose (the ml/ invariant): this module knows nothing
// about persons, orgs or calls — a caller sends audio, gets a vector. What
// a vector MEANS (an enrolled voiceprint, a call speaker's signature) is
// core/'s business entirely.
//
// The dynamic import mirrors the diarizer's: the model is optional per
// deployment and its absence degrades this one endpoint, never startup.

import { access } from "node:fs/promises";
import { config } from "../config.js";
import { MlError } from "../errors.js";
import { logger } from "../log.js";

export interface Embedding {
  vector: number[];
  dim: number;
  /** which extractor produced it — vectors from different models must never
      be compared, so the name travels with every vector */
  model: string;
}

/** the model name callers store beside vectors; bump if the ONNX changes */
export const EMBEDDING_MODEL_NAME = "sherpa-3dspeaker-v1";

let impl: { extractor: any; sherpa: any } | undefined;

export async function embedderAvailable(): Promise<boolean> {
  const cfg = config();
  if (!cfg.ML_EMBEDDING_MODEL) return false;
  try {
    await access(cfg.ML_EMBEDDING_MODEL);
    await load();
    return true;
  } catch {
    return false;
  }
}

async function load(): Promise<{ extractor: any; sherpa: any }> {
  if (impl) return impl;
  const cfg = config();
  const mod: any = await import(/* @vite-ignore */ "sherpa-onnx-node" as string);
  const sherpa = mod.default?.SpeakerEmbeddingExtractor ? mod.default : mod;
  if (!sherpa?.SpeakerEmbeddingExtractor) {
    throw new Error("sherpa-onnx-node exposes no SpeakerEmbeddingExtractor");
  }
  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: cfg.ML_EMBEDDING_MODEL,
    numThreads: cfg.ML_DIARIZER_THREADS ?? 1,
    debug: 0,
  });
  impl = { extractor, sherpa };
  return impl;
}

/**
 * One embedding from mono PCM. Rule 7 lives at the boundary: an extractor
 * that silently produced a zero or NaN vector would "match" nothing forever
 * while every layer stayed green — so a degenerate vector is a loud failure
 * here, never a return value.
 */
export async function embedSamples(
  samples: Float32Array,
  sampleRate: number,
): Promise<Embedding> {
  if (!(await embedderAvailable())) {
    throw new MlError("embedding_unavailable", "no speaker-embedding model on this deployment");
  }
  const { extractor } = await load();
  try {
    const stream = extractor.createStream();
    stream.acceptWaveform({ sampleRate, samples });
    const raw: Float32Array = extractor.compute(stream);
    const vector = Array.from(raw);
    if (vector.length === 0 || vector.every((v) => v === 0) || vector.some((v) => !Number.isFinite(v))) {
      throw new MlError("embedding_failed", "extractor produced a degenerate vector");
    }
    return { vector, dim: vector.length, model: EMBEDDING_MODEL_NAME };
  } catch (e) {
    if (e instanceof MlError) throw e;
    logger.warn({ err: (e as Error)?.message }, "embedding compute failed");
    throw new MlError("embedding_failed", "speaker embedding could not be computed");
  }
}

/** cosine similarity — exported so the acceptance harness and any caller
    score vectors with the SAME arithmetic (two spellings would drift) */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Concatenate the sample ranges (ms) of one voice out of a longer take —
 * how a call speaker's embedding is computed from exactly THEIR speech.
 * Pure, so the slicing math is testable without a model or a microphone.
 */
export function sliceRanges(
  samples: Float32Array,
  sampleRate: number,
  ranges: readonly { start_ms: number; end_ms: number }[],
): Float32Array {
  if (ranges.length === 0) return samples;
  const parts: Float32Array[] = [];
  let total = 0;
  for (const r of ranges) {
    const from = Math.max(0, Math.floor((r.start_ms / 1000) * sampleRate));
    const to = Math.min(samples.length, Math.ceil((r.end_ms / 1000) * sampleRate));
    if (to <= from) continue;
    const part = samples.subarray(from, to);
    parts.push(part);
    total += part.length;
  }
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
