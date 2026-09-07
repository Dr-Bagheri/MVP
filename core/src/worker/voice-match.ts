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
import { scorePerson } from "../api/voiceprint.ts";
import { hasVoiceprintTakes } from "../db/capabilities.ts";
import type { Identity } from "../agent/types.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { MlClient } from "./ml-client.ts";

/**
 * THE BAR, AND IT IS ONE BAR (2026-09-07).
 *
 * It was two: the worker linked at 0.55 and the live recorder's route linked
 * at 0.6, so the same voice in the same meeting could be named on the record
 * and refused mid-take, or the reverse — one decision with two answers, which
 * is the shape this repo keeps finding at seams. Exported here, where the
 * decision lives, and read by both callers.
 *
 * ── CALIBRATION IS PER MODEL, and this pair is not portable ────────────────
 *
 * A cosine threshold means nothing without the extractor that produced the
 * numbers. Measured 2026-09-07 on one person's real recordings — the same
 * voice from a microphone and through the meeting room, plus chunks of a
 * four-person Persian conversation as imposters:
 *
 *   eres2net_base zh-cn (the model until today)
 *     same voice, cross-channel   0.368 – 0.437
 *     best imposter               0.364          → gap 0.014
 *
 *   eres2netv2 16k-common (today's)
 *     same voice, cross-channel   0.571 – 0.638
 *     best imposter               0.351          → gap 0.226
 *
 * The old model could not be given a threshold that both accepted a person
 * across channels and refused a stranger — there was no gap to put one in,
 * which is why raising or lowering the bar never fixed the reports. 0.50 sits
 * in the middle of the new gap: clear of the worst true match by 0.07 and of
 * the best imposter by 0.15. If the model changes again, these numbers are
 * measurements of the OLD one and this constant is stale — re-measure before
 * trusting it.
 */
export const MATCH_THRESHOLD = 0.5;
/** the lead the winner needs over the runner-up — a coin flip is not a name */
export const MATCH_MARGIN = 0.1;

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

/** cosine — re-exported from the package's one spelling (api/voiceprint.ts),
 *  which the enrolment path already uses to build a centroid. Two spellings
 *  of one formula inside one package is how the score that names people and
 *  the score that builds prints come to disagree. */
export { cosine } from "../api/voiceprint.ts";

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
/**
 * A candidate: one person, and every enrolment take they have (db/0207).
 * A print made before that migration arrives here as a single-element list —
 * its centroid — so this function has one shape to reason about and the
 * caller does the "does this deployment have takes" thinking once.
 */
export interface EnrolledPrint {
  person_id: string;
  /** their enrolment takes, newest last; never empty */
  vectors: number[][];
}

export function decideMatch(
  vector: readonly number[],
  prints: readonly EnrolledPrint[],
  threshold: number,
  margin: number,
): { person_id: string; score: number } | { person_id: null; why: string; best?: number } {
  if (prints.length === 0) return { person_id: null, why: "no_enrolled_prints" };
  /*
   * A person scores their BEST take, not their average one (0207). The
   * margin below then compares PEOPLE — two takes of one voice are not two
   * candidates, and scoring them as such would make every well-enrolled
   * person permanently "ambiguous" with themselves.
   */
  const scored = prints
    .map((p) => ({ person_id: p.person_id, score: scorePerson(vector, p.vectors) }))
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
  /* one bar, stated once above — including WHICH model it was measured
     against, because a cosine threshold without its extractor is a number
     about nothing */
  const threshold = input.options?.threshold ?? MATCH_THRESHOLD;
  const margin = input.options?.margin ?? MATCH_MARGIN;
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
  let prints: EnrolledPrint[] | null = null;
  /* asked once, not per speaker: the column is a fact about the deployment */
  const withTakes = await hasVoiceprintTakes(db);
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
        tx.unsafe<{ id: string; voiceprint: number[]; voiceprint_takes: number[][] | null }>(
          `select id, voiceprint${withTakes ? ", voiceprint_takes" : ", null::float8[] as voiceprint_takes"}
             from echo.person
            where merged_into is null and voiceprint is not null
              and voiceprint_model = $1`,
          [embedded.model],
        ),
      );
      /* takes when the person has them, their centroid when they do not —
         a print enrolled before 0207 is a one-take person, and the branch
         lives HERE so `decideMatch` has one shape to reason about */
      prints = rows.map((r) => ({
        person_id: r.id,
        vectors: r.voiceprint_takes !== null && r.voiceprint_takes.length > 0
          ? r.voiceprint_takes
          : [r.voiceprint],
      }));
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
