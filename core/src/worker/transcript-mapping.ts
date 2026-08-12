/**
 * ml/ output → transcript rows. The boundary where a productless facade's
 * output becomes product data (M1/M6, Invariant 6).
 *
 * The division of labour, settled with Backend 2 (ml/CONTRACT.md §3):
 *   ml/  guarantees every timestamp is on the timeline of the FILE it was
 *        given, where 0 is that file's first sample. It knows nothing about
 *        calls, parts or offsets — telling it would leak product structure
 *        into the facade.
 *   core/ owns the arithmetic that places a part inside a call: add
 *        `call_part.offset_ms`. Uniformly — on the degraded path and the
 *        full-fidelity path alike, so there is no special case to get wrong.
 *
 * Degradation ladder (steward M6 + the frontend's per-row gate): word →
 * line → anchored span. Never "nothing", and never a silent seek to 0: when
 * a lane returns no word timing, ml/ still anchors the text to the span of
 * audio it came from, which is usually tighter than the whole part.
 */

export interface MlWord {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence?: number | null;
  speaker?: string | null;
  channel?: number | null;
  language?: string | null;
}

export interface MlProvenance {
  stt?: { lane?: string; timestamps?: "word" | "segment" | "none" } | undefined;
}

export interface MlResult {
  words: MlWord[];
  media?: { duration_ms?: number } | undefined;
  provenance?: MlProvenance | undefined;
  degraded?: boolean | undefined;
  warnings?: string[] | undefined;
}

export interface PartRef {
  id: string;
  /** Where this part starts inside the call. NOT NULL in the schema. */
  offsetMs: number;
  /** Null while unknown (the worker sets it from ml/'s media duration). */
  durationMs?: number | null;
  /**
   * First `seq` to assign — normally `seqBaseForPart(part.idx)`.
   *
   * `echo.transcript_segment` is UNIQUE (call_id, seq), so seq is unique
   * across the CALL, not the part: a second part starting again at 0 collides
   * with the first, on every recording over 30 minutes.
   */
  seqStart?: number;
}

/**
 * Segments a single part may hold before it would run into the next part's
 * range. A 30-minute part (M7's ceiling) would need one segment every 18ms to
 * reach this, which no speech produces.
 */
export const SEQ_STRIDE = 100_000;

/**
 * Deterministic seq range per part: `idx × stride`.
 *
 * The obvious alternative — "count what is already stored for this call and
 * continue from there" — is a read-modify-write across jobs. Two parts of one
 * call processed at the same time read the same count and collide, which is
 * the same bug as numbering from zero, only intermittent and therefore worse.
 *
 * Deriving the base from the part's own index needs no coordination, no lock,
 * and no ordering guarantee between workers. It is also idempotent: a retried
 * part recomputes the identical numbers, so a duplicate insert trips the
 * unique constraint loudly instead of silently appending a second copy of
 * somebody's transcript.
 */
export function seqBaseForPart(partIdx: number): number {
  if (!Number.isInteger(partIdx) || partIdx < 0) {
    throw new InvalidTimingError(`part index must be a non-negative integer, got ${partIdx}`);
  }
  return partIdx * SEQ_STRIDE;
}

export interface MappedSegment {
  partId: string;
  seq: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  words: { w: string; startMs: number; endMs: number }[];
}

export interface MappedTranscript {
  segments: MappedSegment[];
  /** Per-part truth: did this lane give word-level timing? */
  hasWordTimestamps: boolean;
  degraded: boolean;
}

export class InvalidTimingError extends Error {}

/** The shortest span we will store for a segment that would otherwise collapse. */
const MIN_SEGMENT_MS = 1;

/**
 * WORD timing. A word may legitimately have zero duration and it is not an
 * error: measured on the real Persian fixture, «و» ("and") comes back at
 * 45128–45128 — one vowel, spoken fast, honestly reported by the provider.
 *
 * This function used to demand end > start per word, which would have thrown
 * on that word and failed the entire call. The invariant ml/ actually
 * guarantees is at the SEGMENT level and on the degraded anchored path; it was
 * being enforced one level below where it was promised, which reads as extra
 * rigour and behaves as a landmine.
 *
 * Inverted and non-finite remain errors — those are corruption, not brevity.
 */
function assertWordTiming(startMs: number, endMs: number, context: string): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new InvalidTimingError(`${context}: non-finite timing`);
  }
  if (endMs < startMs) {
    throw new InvalidTimingError(`${context}: end_ms (${endMs}) < start_ms (${startMs})`);
  }
}

/**
 * SEGMENT timing — this is the invariant that matters. A segment is what lands
 * in `echo.transcript_segment`'s NOT NULL columns and what the player seeks
 * to, so a zero-length one is meaningless data the database would accept
 * without complaint.
 */
function assertSpan(startMs: number, endMs: number, context: string): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new InvalidTimingError(`${context}: non-finite timing`);
  }
  if (endMs <= startMs) {
    throw new InvalidTimingError(`${context}: end_ms (${endMs}) <= start_ms (${startMs})`);
  }
}

/**
 * Group ml/ words into speaker-turn segments and place them on the call
 * timeline. A new segment starts when the speaker changes.
 */
export function mapWordsToSegments(result: MlResult, part: PartRef): MappedTranscript {
  const timestamps = result.provenance?.stt?.timestamps ?? "none";
  const hasWordTimestamps = timestamps === "word";
  const degraded = Boolean(result.degraded) || !hasWordTimestamps;
  const offset = part.offsetMs;

  if (!Number.isFinite(offset) || offset < 0) {
    throw new InvalidTimingError("part offset must be a non-negative number");
  }

  const segments: MappedSegment[] = [];
  let current: MappedSegment | undefined;

  for (const word of result.words) {
    const startMs = offset + word.start_ms;
    const endMs = offset + word.end_ms;
    assertWordTiming(startMs, endMs, `word "${word.text.slice(0, 24)}"`);

    const speaker = word.speaker ?? null;
    if (!current || current.speaker !== speaker) {
      current = {
        partId: part.id,
        seq: (part.seqStart ?? 0) + segments.length,
        startMs,
        endMs,
        text: word.text.trim(),
        speaker,
        words: [],
      };
      segments.push(current);
    } else {
      current.text = `${current.text} ${word.text.trim()}`.trim();
      current.endMs = Math.max(current.endMs, endMs);
    }
    // Word-level rows only mean something when the lane actually produced
    // them; on a degraded part the "words" are the anchored span, and
    // storing them would fake click-a-word precision we don't have.
    if (hasWordTimestamps) {
      current.words.push({ w: word.text, startMs, endMs });
    }
  }

  for (const segment of segments) {
    // A segment can still collapse legitimately: a lone zero-length word that
    // happens to be its own speaker turn. Widen it to the shortest storable
    // span rather than drop the word or store a meaningless 0–0. One
    // millisecond is far below any seek precision a listener can perceive, so
    // it asserts nothing false about when the word was said.
    if (segment.endMs === segment.startMs) {
      segment.endMs = segment.startMs + MIN_SEGMENT_MS;
    }
    assertSpan(segment.startMs, segment.endMs, `segment ${segment.seq}`);
  }

  return { segments, hasWordTimestamps, degraded };
}

/**
 * The call-level boolean the UI reads (M6): true only when EVERY part has
 * word timing. One degraded part makes the call partially seekable, and the
 * client gates seeking per row on top of this.
 */
export function callHasWordTimestamps(parts: { hasWordTimestamps: boolean }[]): boolean {
  return parts.length > 0 && parts.every((p) => p.hasWordTimestamps);
}
