/**
 * The per-part step: audio in, transcript rows out.
 *
 * **Why one step and not four** (M7 amendment, ratified). M7 originally named
 * the per-part DAG as `transcode → vad → transcribe → diarize` and db/0017
 * created a queue for each. ml/'s `/process` performs all four in one
 * synchronous call, so three of those queues would have had no consumer, and
 * three no-op queues read like a pipeline and behave like a lie. db/0019
 * replaced them with a single `echo_process_part`; this step consumes it and
 * walks the part through the status ladder the schema defines, so the status
 * column still IS the position (M7) and the progress UI is unaffected.
 *
 * The trade-off, recorded rather than buried: retry granularity. A failure
 * after a successful transcription re-pays for the STT, because /process is
 * one call. The exposure is narrow — an ml/-side failure bills nothing AND
 * stores nothing, so the only re-pay window is a crash between a successful
 * response and the database write. Splitting ml/ into four endpoints was
 * rejected as the worse trade: it would leak orchestration into a productless
 * facade and make it stateful (invariant 6).
 *
 * Idempotency is keyed to the ARTIFACT, never to a flag (M7): the step asks
 * whether this part already has transcript rows, because a flag can be wrong
 * and rows cannot.
 *
 * **Identity comes from the payload, and only from the payload.** A job runs
 * as the call's OWNER (M3/M4) — there is no service-account path here and no
 * privileged read "just to find out who owns this". If the owner cannot be
 * resolved, nothing is written at all: invariant 2 keeps no convenience
 * exception.
 */
import type { Identity } from "../agent/types.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";
import { resolveJobIdentity } from "./job-identity.ts";
import { unknownVocabulary, type MlClient } from "./ml-client.ts";
import {
  mapWordsToSegments,
  seqBaseForPart,
  SEQ_STRIDE,
  type MappedSegment,
} from "./transcript-mapping.ts";
import {
  partsSettled,
  type Lifecycle,
  type PartRow,
} from "./lifecycle.ts";
import { Q_LINK_SPEAKERS, Q_PROCESS_PART, type JobPayload, type Queue } from "./queue.ts";
import { StepError, type StepHandler, type StepLogger } from "./runner.ts";

/**
 * Audio never reaches ml/ as a product credential: the worker mints a
 * short-lived signed URL that carries its own authority and expires. ml/ holds
 * no key of ours, and a leaked URL dies on its own.
 */
export interface StorageSigner {
  signDownload(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

export interface PartStepOptions {
  db: Db;
  ml: MlClient;
  queue: Queue;
  lifecycle: Lifecycle;
  storage: StorageSigner;
  /** Signed-URL lifetime. Long enough for a slow part, short enough to matter. */
  signedUrlTtlSec?: number;
}

export function createPartStep({
  db,
  ml,
  queue,
  lifecycle,
  storage,
  signedUrlTtlSec = 60 * 60,
}: PartStepOptions): StepHandler {
  return {
    name: "process_part",
    queue: Q_PROCESS_PART,

    async handle(payload: JobPayload, { log }) {
      if (!payload.partId) {
        // A per-part message with no part is malformed and will never become
        // valid. Non-retryable by nature.
        throw new StepError("bad_payload", "per-part job carries no partId", false);
      }

      // Identity first, and from the payload: the job runs as the call's
      // OWNER (M3/M4). identityForJob re-reads the call as that owner and
      // fails closed if it is not visible — a stale or forged payload stops
      // here rather than proceeding under an identity that does not own the
      // work. There is no service-account path.
      const identity = await resolveJobIdentity(db, payload);

      const part = await lifecycle.getPart(identity, payload.partId);
      if (!part) {
        throw new StepError("part_not_found", "part is not visible to the call owner", false);
      }

      if (part.missing) {
        log.info({ part_id: part.id }, "part already marked missing; nothing to do");
        return;
      }

      // Idempotency against the artifact, not a flag: if rows already exist
      // for this part, a previous attempt succeeded and only the bookkeeping
      // was lost. Re-running would duplicate a customer's transcript.
      if (await hasTranscript(db, identity, part.id)) {
        log.info({ part_id: part.id }, "transcript already present; advancing only");
        await finishPart(identity, part, lifecycle, queue, payload, log);
        return;
      }

      if (!part.storage_path) {
        throw new StepError("no_audio", "part has no stored audio", false);
      }

      await lifecycle.bumpAttempts(identity, part.id);

      const audioUrl = await storage.signDownload(
        part.storage_bucket,
        part.storage_path,
        signedUrlTtlSec,
      );

      // The signed URL is a credential; it is passed, never logged.
      const result = await ml.process({
        audioUrl,
        // Opaque to ml/ — correlation only, no authority, no meaning there.
        jobRef: part.id,
      });

      // A value ml/ publishes that this worker does not recognise means the
      // contract moved without us. The job still completes — conservatively,
      // since an unknown granularity is not `"word"` — but it is never silent:
      // a whole call quietly losing click-a-word with nothing rejected is the
      // failure this check exists to prevent.
      const drift = unknownVocabulary(result);
      if (drift.length > 0) {
        log.error(
          { part_id: part.id, drift, ml_version: result.provenance.ml_version },
          "ml/ returned vocabulary this worker does not know — treating conservatively",
        );
      }

      const mapped = mapWordsToSegments(result, {
        id: part.id,
        offsetMs: part.offset_ms,
        durationMs: result.media.duration_ms,
        // Derived from the part's own index, never from a count of what is
        // already stored: a count is a read-modify-write that two concurrent
        // parts of one call would both win.
        seqStart: seqBaseForPart(part.idx),
      });

      if (mapped.segments.length > SEQ_STRIDE) {
        // Would run into the next part's range. Impossible for real speech, so
        // if it happens something upstream is producing garbage — refuse
        // rather than silently overwrite the neighbouring part's transcript.
        throw new StepError(
          "too_many_segments",
          `part produced ${mapped.segments.length} segments, above the ${SEQ_STRIDE} range`,
          false,
        );
      }

      // The roster is built HERE, while ml/'s labels are still in hand. They
      // are local to one response (S1, S2 by first appearance) and mean
      // nothing outside it, so if they are not resolved to call_speaker rows
      // now, the information is gone and link_speakers has nothing to work
      // from.
      const speakerIds = await upsertSpeakers(db, identity, part, mapped.segments, result);

      await writeTranscript(db, identity, part, mapped.segments, result, speakerIds);

      // db/0020: assert the flag once per part, after the segments are in, and
      // only when every one of them carries real word timings. The losing side
      // is a trigger's job — a later correction that blanks a segment's words
      // demotes the part automatically — so this is one-way and needs no
      // cleanup path on our side.
      const hasWordTimestamps =
        mapped.hasWordTimestamps && mapped.segments.every((s) => s.words.length > 0);

      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call_part
              set duration_ms = $2, status = 'transcribed', has_word_timestamps = $3
            where id = $1`,
          [part.id, result.media.duration_ms, hasWordTimestamps],
        ),
      );

      // The call's own duration, from the parts that have landed. db/0004's
      // comment has always said "maintained by the worker as parts land";
      // until now nothing did it, and the api served null on every live row.
      await lifecycle.recomputeCallDuration(identity, part.call_id);

      log.info(
        {
          part_id: part.id,
          segments: mapped.segments.length,
          degraded: mapped.degraded,
          lane: result.provenance.stt.lane,
          timestamps: result.provenance.stt.timestamps,
        },
        // A 200 from ml/ is not automatically a full-fidelity transcript
        // (M6 degrade-and-flag). The flag is stored, not just logged.
        mapped.degraded ? "part transcribed (DEGRADED)" : "part transcribed",
      );

      await finishPart(identity, part, lifecycle, queue, payload, log);
    },
  };
}

/**
 * Advance the part to the end of the per-part ladder, then ask whether the
 * call as a whole can move on.
 */
async function finishPart(
  identity: Identity,
  part: PartRow,
  lifecycle: Lifecycle,
  queue: Queue,
  payload: JobPayload,
  log: StepLogger,
): Promise<void> {
  await lifecycle.setPartStatus(identity, part.id, "diarized");

  const parts = await lifecycle.partsOfCall(identity, part.call_id);
  if (!partsSettled(parts)) {
    log.info(
      { call_id: part.call_id, done: parts.filter((p) => p.status === "diarized" || p.missing).length, total: parts.length },
      "call still has parts in flight",
    );
    return;
  }

  // Every part has settled — finished or written off as a gap. The call moves
  // to its per-call phase exactly once, and enqueueing is idempotent enough:
  // link_speakers re-checks state before doing anything.
  await lifecycle.setCallStatus(identity, part.call_id, "linking");
  await queue.send(Q_LINK_SPEAKERS, { callId: payload.callId, ownerId: payload.ownerId });
  log.info({ call_id: part.call_id }, "all parts settled; queued link_speakers");
}

async function hasTranscript(db: Db, identity: Identity, partId: string): Promise<boolean> {
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<{ n: string }>(
      `select count(*)::text as n from echo.transcript_segment where part_id = $1`,
      [partId],
    ),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * ml/'s speaker labels → `echo.call_speaker` rows.
 *
 * **Each (part, label) pair gets its OWN roster entry, deliberately.** ml/'s
 * labels are local to one response: part 1's "S1" and part 2's "S1" are two
 * unrelated numberings, and nothing in the pipeline compares voices ACROSS
 * parts. Collapsing them by name would attribute one person's words to
 * another — silently, and in the record the product treats as the truth.
 *
 * So a two-part call starts with a longer roster than it needs, and a human
 * merges the duplicates, which SPEC already provides for ("duplicates can be
 * merged"). A roster that is too long is a chore; a roster that is wrong is a
 * misquote. Flagged to the steward as a product-visible choice.
 */
async function upsertSpeakers(
  db: Db,
  identity: Identity,
  part: PartRow,
  segments: readonly MappedSegment[],
  result: { provenance: { diarization: { source: string } }; words: { speaker: string | null; channel: number | null }[] },
): Promise<Map<string, string>> {
  const labels = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => Boolean(s)))];
  const ids = new Map<string, string>();
  if (labels.length === 0) return ids;

  // Two-channel audio takes speakers from the microphones (M6), so the
  // channel is real information worth keeping on the roster row.
  const channelOf = new Map<string, number | null>();
  if (result.provenance.diarization.source === "channels") {
    for (const word of result.words) {
      if (word.speaker && !channelOf.has(word.speaker)) channelOf.set(word.speaker, word.channel);
    }
  }

  await db.withIdentity(identity, async (tx: SqlTx) => {
    for (const label of labels) {
      // Unique per call, and stable across retries: the same part and the
      // same ml/ label always produce the same roster label, so a re-run
      // finds its own row instead of adding a duplicate.
      const rosterLabel = `${label}·${part.idx + 1}`;
      const rows = await tx.unsafe<{ id: string }>(
        `insert into echo.call_speaker (call_id, org_id, label, channel)
         values ($1, $2, $3, $4)
         on conflict (call_id, label) do update set label = excluded.label
         returning id`,
        [part.call_id, identity.orgId, rosterLabel, channelOf.get(label) ?? null],
      );
      if (rows[0]) ids.set(label, rows[0].id);
    }
  });

  return ids;
}

async function writeTranscript(
  db: Db,
  identity: Identity,
  part: PartRow,
  segments: readonly MappedSegment[],
  result: { provenance: unknown; degraded: boolean; words: { channel: number | null }[] },
  speakerIds: Map<string, string>,
): Promise<void> {
  if (segments.length === 0) return;

  // Invariant 4: every derived row records what produced it. The whole ml/
  // provenance block rides along, including the degraded flag and the lane —
  // that is what lets the UI disable seeking and what a re-transcription pass
  // will key off.
  // Bound through db/jsonb.ts, like every other jsonb parameter in the
  // codebase. Handing a driver an already-stringified value makes the column a
  // jsonb *string* rather than an object or array — which tripped
  // `transcript_segment_words_is_array` here, and where no constraint exists
  // stores a quoted blob that reads correctly until something indexes into it.
  const provenance = {
    source: "ml",
    degraded: result.degraded,
    ...(result.provenance as Record<string, unknown>),
  };

  await db.withIdentity(identity, async (tx: SqlTx) => {
    for (const segment of segments) {
      await tx.unsafe(
        `insert into echo.transcript_segment
           (call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text, words, provenance)
         values ($1, $2, $3, $4, $5, $6, $7, $8, ${JSONB_PARAM(9)}, ${JSONB_PARAM(10)})`,
        [
          part.call_id,
          identity.orgId,
          part.id,
          segment.seq,
          segment.startMs,
          segment.endMs,
          segment.speaker ? (speakerIds.get(segment.speaker) ?? null) : null,
          segment.text,
          toJsonb(segment.words.map((w) => ({ w: w.w, s: w.startMs, e: w.endMs }))),
          toJsonb(provenance),
        ],
      );
    }
  });
}
