/**
 * Voice matching (M39, 2026-08-22): after a call's speakers exist, compare
 * each UNLINKED voice against the org's ENROLLED voiceprints and link the
 * confident ones — with provenance, undoable in the UI.
 *
 * The consent line (the M11 amendment's hinge): enrolling IS the deliberate
 * act. A person with no voiceprint is never matched, never named; nothing
 * here creates directory entries or stores new vectors. The pipeline only
 * recognizes people who explicitly asked to be recognizable.
 *
 * Best-effort by design: this runs inside link_speakers but a failure here
 * (ml down, old ml without /embed, storage hiccup) NEVER blocks the
 * pipeline — the call proceeds exactly as before the feature existed, and
 * the forfeit is logged out loud (M21). Matching can be re-earned on a
 * future call; a call stuck behind a matcher could not.
 *
 * Decision rule, deliberately conservative (a wrong name on a transcript
 * is worse than no name): cosine ≥ THRESHOLD and a clear MARGIN over the
 * runner-up. Both env-tunable; the defaults come from the synthetic-voice
 * acceptance run and stay strict until real enrollments calibrate them.
 */
import type { Identity } from "../agent/types.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { MlClient } from "./ml-client.ts";

export interface VoiceMatchOptions {
  /** minimum cosine similarity to link at all */
  threshold?: number;
  /** required lead over the second-best candidate */
  margin?: number;
  /** minimum speech (ms) a speaker needs before a signature means anything */
  minSpeechMs?: number;
  /** most speech (ms) fed to the extractor per speaker */
  maxSpeechMs?: number;
}

export interface StorageSignerLike {
  signDownload(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

interface SegmentRow {
  part_id: string | null;
  start_ms: number;
  end_ms: number;
  call_speaker_id: string;
}

interface PartRow {
  id: string;
  offset_ms: number;
  storage_bucket: string;
  storage_path: string | null;
}

/** cosine, spelled once here for the worker. ml/ scores with the same
 *  arithmetic (its exported `cosine`); the formula is standard enough that
 *  the duplication risk is nil, and a cross-package import is not. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pick the speaker's best material: the ONE part where they spoke most
 * (an embedding needs one audio file), their longest segments first, capped.
 * Pure, so the selection logic is testable without audio or a database.
 */
export function pickSpeechRanges(
  segments: readonly SegmentRow[],
  parts: readonly PartRow[],
  speakerId: string,
  maxSpeechMs: number,
): { part: PartRow; ranges: { start_ms: number; end_ms: number }[]; speechMs: number } | null {
  const own = segments.filter(
    (s) => s.call_speaker_id === speakerId && s.part_id !== null && s.end_ms > s.start_ms,
  );
  if (own.length === 0) return null;
  const byPart = new Map<string, number>();
  for (const s of own) {
    byPart.set(s.part_id!, (byPart.get(s.part_id!) ?? 0) + (s.end_ms - s.start_ms));
  }
  let bestPartId: string | null = null;
  let bestMs = 0;
  for (const [partId, ms] of byPart) {
    if (ms > bestMs) { bestMs = ms; bestPartId = partId; }
  }
  const part = parts.find((p) => p.id === bestPartId && p.storage_path !== null);
  if (!part) return null;
  const inPart = own
    .filter((s) => s.part_id === part.id)
    .sort((a, b) => (b.end_ms - b.start_ms) - (a.end_ms - a.start_ms));
  const ranges: { start_ms: number; end_ms: number }[] = [];
  let total = 0;
  for (const s of inPart) {
    if (total >= maxSpeechMs) break;
    // segment times are call-absolute; the audio file starts at part.offset_ms
    const start = Math.max(0, s.start_ms - part.offset_ms);
    const end = Math.max(start, s.end_ms - part.offset_ms);
    if (end <= start) continue;
    ranges.push({ start_ms: start, end_ms: end });
    total += end - start;
  }
  // chronological — the extractor cares nothing for order, but a log line
  // someone reads during a diagnosis does
  ranges.sort((a, b) => a.start_ms - b.start_ms);
  return ranges.length > 0 ? { part, ranges, speechMs: total } : null;
}

/**
 * The decision, pure: which print (if any) does this vector name?
 * `null` carries WHY (rule 12: name the nothing) for the log line.
 */
export function decideMatch(
  vector: readonly number[],
  prints: readonly { person_id: string; vector: number[] }[],
  threshold: number,
  margin: number,
): { person_id: string; score: number } | { person_id: null; why: string; best?: number } {
  if (prints.length === 0) return { person_id: null, why: "no_enrolled_prints" };
  const scored = prints
    .map((p) => ({ person_id: p.person_id, score: cosine(vector, p.vector) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1]?.score ?? -1;
  if (best.score < threshold) return { person_id: null, why: "below_threshold", best: best.score };
  if (best.score - second < margin) return { person_id: null, why: "ambiguous", best: best.score };
  return { person_id: best.person_id, score: best.score };
}

export async function matchEnrolledVoices(input: {
  db: Db;
  ml: MlClient;
  storage: StorageSignerLike;
  identity: Identity;
  callId: string;
  log: {
    info: (fields: Record<string, unknown>, message: string) => void;
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  options?: VoiceMatchOptions;
}): Promise<void> {
  const { db, ml, storage, identity, callId, log } = input;
  const threshold = input.options?.threshold ?? 0.6;
  const margin = input.options?.margin ?? 0.1;
  const minSpeechMs = input.options?.minSpeechMs ?? 3_000;
  const maxSpeechMs = input.options?.maxSpeechMs ?? 60_000;

  const unlinked = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ id: string }>(
      `select id from echo.call_speaker
        where call_id = $1 and person_id is null`,
      [callId],
    ),
  );
  if (unlinked.length === 0) return;

  const segments = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<SegmentRow>(
      `select part_id, start_ms, end_ms, call_speaker_id
         from echo.transcript_segment
        where call_id = $1 and call_speaker_id is not null`,
      [callId],
    ),
  );
  const parts = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<PartRow>(
      `select id, offset_ms, storage_bucket, storage_path
         from echo.call_part
        where call_id = $1`,
      [callId],
    ),
  );

  // one embed per speaker; prints fetched once the MODEL is known (the name
  // rides every /embed response — no cross-package constant to drift)
  let prints: { person_id: string; vector: number[] }[] | null = null;
  for (const speaker of unlinked) {
    const pick = pickSpeechRanges(segments, parts, speaker.id, maxSpeechMs);
    if (!pick || pick.speechMs < minSpeechMs) {
      log.info({ call_id: callId, speaker_id: speaker.id, why: "too_little_speech" },
        "voice match skipped");
      continue;
    }
    const audioUrl = await storage.signDownload(pick.part.storage_bucket, pick.part.storage_path!, 600);
    const embedded = await ml.embed({ audioUrl, ranges: pick.ranges, jobRef: speaker.id });
    if (prints === null) {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; voiceprint: number[] }>(
          `select id, voiceprint from echo.person
            where merged_into is null and voiceprint is not null
              and voiceprint_model = $1`,
          [embedded.model],
        ),
      );
      prints = rows.map((r) => ({ person_id: r.id, vector: r.voiceprint }));
      if (prints.length === 0) {
        // nobody in this org asked to be recognized (for this model) — done,
        // and said out loud once rather than once per speaker
        log.info({ call_id: callId, model: embedded.model }, "voice match: no enrolled prints");
        return;
      }
    }
    const verdict = decideMatch(embedded.embedding, prints, threshold, margin);
    if (verdict.person_id === null) {
      log.info(
        { call_id: callId, speaker_id: speaker.id, why: verdict.why, best: verdict.best },
        "voice match: no confident match",
      );
      continue;
    }
    // provenance: linked_by is the job's identity (the call owner) — the
    // UI shows the link like any hand-made one and unlinking undoes it
    await db.withIdentity(identity, (tx: SqlTx) =>
      tx.unsafe(
        `update echo.call_speaker
            set person_id = $2, linked_by = $3, linked_at = now()
          where id = $1 and person_id is null`,
        [speaker.id, verdict.person_id, identity.userId],
      ),
    );
    log.info(
      { call_id: callId, speaker_id: speaker.id, person_id: verdict.person_id,
        score: Math.round(verdict.score * 1000) / 1000 },
      "voice match: linked",
    );
  }
}
