import type { Pcm } from "../audio/wav.js";
import type { Segment } from "../schema.js";

export type { Segment };

export interface VadResult {
  segments: Segment[];
  engine: string;
  threshold: number;
}

export interface VadEngine {
  readonly name: string;
  readonly threshold: number;
  /** Speech regions on the timeline of the PCM handed in. */
  detect(pcm: Pcm): Promise<Segment[]>;
}

export interface SegmentationOpts {
  /** Frame length the probabilities were produced at. */
  frameMs: number;
  /** Drop speech shorter than this — clicks and lip smacks are not utterances. */
  minSpeechMs: number;
  /** A gap shorter than this does not end an utterance; it is a breath. */
  minSilenceMs: number;
  /** Grow each region outward so we never clip a word's onset or tail. */
  padMs: number;
  durationMs: number;
}

/**
 * Frame probabilities → speech regions. Shared by every engine so that
 * swapping the model never silently changes the segmentation behaviour.
 */
export function probsToSegments(
  probs: readonly number[],
  threshold: number,
  o: SegmentationOpts,
): Segment[] {
  const raw: Segment[] = [];
  let start: number | null = null;

  for (let i = 0; i < probs.length; i++) {
    const speech = (probs[i] ?? 0) >= threshold;
    if (speech && start === null) start = i * o.frameMs;
    if (!speech && start !== null) {
      raw.push({ start_ms: start, end_ms: i * o.frameMs });
      start = null;
    }
  }
  if (start !== null) raw.push({ start_ms: start, end_ms: probs.length * o.frameMs });

  // Bridge short gaps, then drop short speech, then pad and clamp. Order
  // matters: bridging first stops a breath from splitting one utterance into
  // two that are each too short to survive the next filter.
  const bridged: Segment[] = [];
  for (const seg of raw) {
    const prev = bridged[bridged.length - 1];
    if (prev && seg.start_ms - prev.end_ms < o.minSilenceMs) prev.end_ms = seg.end_ms;
    else bridged.push({ ...seg });
  }

  return bridged
    .filter((s) => s.end_ms - s.start_ms >= o.minSpeechMs)
    .map((s) => ({
      start_ms: Math.max(0, s.start_ms - o.padMs),
      end_ms: Math.min(o.durationMs, s.end_ms + o.padMs),
    }));
}
