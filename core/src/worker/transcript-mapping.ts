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

export interface MlSpeechRegion {
  start_ms: number;
  end_ms: number;
}

export interface MlResult {
  words: MlWord[];
  media?: { duration_ms?: number } | undefined;
  /**
   * Where the VAD heard speech, on the same timeline as `words`.
   *
   * This is the line boundary (M20). ml/ measured it from the audio itself
   * rather than guessing it from the text, which is what makes it usable as a
   * boundary at all — the alternative is a pause threshold someone invents and
   * everyone then argues about.
   */
  speech?: { segments?: MlSpeechRegion[] | undefined } | undefined;
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
 * The backstop, for a lane that offers neither speakers nor speech regions.
 *
 * Deliberately generous: it is not a line-length preference, it is a ceiling
 * that stops one row swallowing an entire recording when both real boundaries
 * are missing. If it fires often, the input is the problem.
 */
const SEGMENT_MAX_WORDS = 80;

/**
 * Which VAD speech region does this moment fall in?
 *
 * Returns the index of the last region starting at or before `ms`, or -1 for a
 * word that precedes every region. Only CHANGES matter to the caller, so a
 * word sitting in the silence between two regions keeps the preceding index
 * and does not manufacture a break of its own.
 */
function speechRegionAt(regions: readonly MlSpeechRegion[], ms: number): number {
  let found = -1;
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]!;
    if (!Number.isFinite(region.start_ms)) continue;
    if (region.start_ms <= ms) found = i;
    else break; // regions are ordered; nothing later can start earlier
  }
  return found;
}

/**
 * Group ml/ words into segments and place them on the call timeline.
 *
 * **A new segment starts on a speaker change OR a VAD speech boundary** (M20),
 * with a word-count backstop when a lane gives neither.
 *
 * Speaker change alone was the original rule, and it made a single-speaker
 * recording ONE segment: 86 seconds of one voice landed as a single row, and a
 * 30-minute dictation would have landed as one row holding every word. Three
 * things break at once when that happens — the timing ladder's middle rung has
 * nothing to degrade to (word → line → span, with no lines), a search snippet's
 * unit becomes the entire call, and ml/'s contract says in as many words that
 * lines are the product's to build ("ml/ returns words, not lines") while the
 * product was not building them.
 *
 * The boundary is `speech.segments` — silence MEASURED from the audio, already
 * delivered on every response and previously discarded — rather than a pause
 * threshold invented here. That distinction is the reason this is a fix and
 * not a preference.
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

  // Regions are on ml/'s 0-based part timeline, exactly like `word.start_ms`,
  // so they are compared BEFORE the offset is added. Adding it to one side
  // only would put every boundary in the wrong place on any part after the
  // first — silently, and only on multi-part calls.
  const regions = result.speech?.segments ?? [];
  // On a degraded part every word carries the same anchored span, so region
  // lookups and word counts would slice one span into rows that all claim the
  // same moment. M20 says that rung is ONE anchored segment; keep it that way.
  const canSplitOnSpeech = hasWordTimestamps && regions.length > 0;
  let previousRegion = -1;

  for (const word of result.words) {
    const startMs = offset + word.start_ms;
    const endMs = offset + word.end_ms;
    assertWordTiming(startMs, endMs, `word "${word.text.slice(0, 24)}"`);

    const speaker = word.speaker ?? null;
    const region = canSplitOnSpeech ? speechRegionAt(regions, word.start_ms) : previousRegion;
    const crossedSilence = current !== undefined && region !== previousRegion;
    const tooLong = hasWordTimestamps && (current?.words.length ?? 0) >= SEGMENT_MAX_WORDS;
    previousRegion = region;

    if (!current || current.speaker !== speaker || crossedSilence || tooLong) {
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
