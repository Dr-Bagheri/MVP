import type { SttWord } from "../stt/types.js";

export interface DiarSegment {
  start_ms: number;
  end_ms: number;
  /** Local label: S1, S2, … numbered by first appearance. */
  speaker: string;
}

export interface Diarizer {
  readonly name: string;
  available(): Promise<boolean>;
  /** `file` is a mono 16 kHz PCM WAV; timestamps come back on ITS timeline. */
  diarize(file: string, opts: { maxSpeakers: number }): Promise<DiarSegment[]>;
}

/**
 * Attach speakers to words by maximum temporal overlap.
 *
 * Diarization and transcription are two independent views of the same audio;
 * their boundaries never line up exactly. A word belongs to whichever speaker
 * covers most of it, and to nobody when nothing covers it at all — an unlabeled
 * word is honest, a guessed one is not.
 */
export function assignSpeakers(words: readonly SttWord[], segments: readonly DiarSegment[]): SttWord[] {
  if (segments.length === 0) return words.map((w) => ({ ...w }));

  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms);

  return words.map((w) => {
    let best: string | null = null;
    let bestOverlap = 0;

    for (const s of sorted) {
      if (s.start_ms >= w.end_ms) break; // sorted: nothing later can overlap
      const overlap = Math.min(w.end_ms, s.end_ms) - Math.max(w.start_ms, s.start_ms);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = s.speaker;
      }
    }

    // A zero-length word (some lanes emit them) still deserves a speaker if a
    // segment contains its instant.
    if (best === null && w.end_ms === w.start_ms) {
      best = sorted.find((s) => w.start_ms >= s.start_ms && w.start_ms <= s.end_ms)?.speaker ?? null;
    }

    return { ...w, speaker: best };
  });
}
