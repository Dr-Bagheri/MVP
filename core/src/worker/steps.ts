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
import { hasOrgGlossary } from "../db/capabilities.ts";
import { JSONB_ARRAY_PARAM, JSONB_PARAM, toJsonb, toJsonbArray } from "../db/jsonb.ts";
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

/**
 * call.language → the transcriber's language_hints. An explicit single
 * language narrows the hints (a pure-Persian meeting hinted fa-only
 * transcribes better — the feature's whole point); 'mixed' means both.
 * Unknown vocabulary also means both: hints are a steer, and narrowing on a
 * value we don't recognise would be the enum-drift failure pointed at audio.
 */
export function languageHintsFor(callLanguage: string): string[] {
  if (callLanguage === "fa") return ["fa"];
  if (callLanguage === "en") return ["en"];
  return ["fa", "en"];
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

      /*
       * ── PRE-FLIGHT, in ONE transaction (speed pass, 2026-08-29) ──────────
       *
       * The part read, the idempotency check, the attempt bump and the
       * glossary read were four separate transactions against the same row's
       * neighbourhood. They are one now.
       *
       * The branching stays INSIDE it so the attempt bump keeps its
       * preconditions exactly: a part that is missing, already transcribed, or
       * has no audio must not be charged an attempt, and merging the reads
       * with the write would have bumped before the decision if the decision
       * were made outside.
       *
       * This transaction COMMITS BEFORE ml/ is called, and that is
       * load-bearing twice over. The attempt count is evidence for an operator
       * reading a dead letter, so it has to survive the crash it is evidence
       * of — an uncommitted bump is lost exactly when it matters. And db/0053
       * reaps a connection idle in a transaction after five minutes, so a
       * transaction held open across `ml.process` (minutes, for a long part)
       * would be killed mid-job on precisely the parts that take longest.
       * Nothing here may grow to span that call.
       */
      const preflight = await db.withIdentity(identity, async (tx: SqlTx) => {
        const part = await lifecycle.getPart(identity, payload.partId!, tx);
        if (!part) return { verdict: "not_found" as const };
        if (part.missing) return { verdict: "missing" as const, part };

        // Idempotency against the artifact, not a flag: if rows already exist
        // for this part, a previous attempt succeeded and only the bookkeeping
        // was lost. Re-running would duplicate a customer's transcript.
        if (await hasTranscript(tx, part.id)) return { verdict: "already" as const, part };
        if (!part.storage_path) return { verdict: "no_audio" as const, part };

        await lifecycle.bumpAttempts(identity, part.id, tx);

        /*
         * The org GLOSSARY (0088, 2026-08-23): names and terms the org
         * recorded to bias recognition toward — Persian proper names are
         * where the transcriber's errors concentrate. Read under the owner's
         * identity like everything else; absent column or empty list = no
         * context sent. Best-effort: a failed read costs the bias, never the
         * transcription — so the failure is caught HERE rather than allowed
         * to roll back the attempt bump it now shares a transaction with.
         */
        let glossary: string[] = [];
        if (await hasOrgGlossary(db)) {
          try {
            const rows = await tx.unsafe<{ glossary: string[] }>(
              `select o.glossary from echo.org o where o.id = $1`,
              [identity.orgId],
            );
            glossary = rows[0]?.glossary ?? [];
          } catch {
            log.warn({ part_id: part.id }, "glossary read failed; transcribing without context");
          }
        }
        return { verdict: "go" as const, part, glossary };
      });

      if (preflight.verdict === "not_found") {
        throw new StepError("part_not_found", "part is not visible to the call owner", false);
      }
      if (preflight.verdict === "missing") {
        log.info({ part_id: preflight.part.id }, "part already marked missing; nothing to do");
        return;
      }
      if (preflight.verdict === "already") {
        log.info({ part_id: preflight.part.id }, "transcript already present; advancing only");
        await finishPart(identity, preflight.part, lifecycle, queue, payload, log);
        return;
      }
      if (preflight.verdict === "no_audio") {
        throw new StepError("no_audio", "part has no stored audio", false);
      }
      const { part, glossary } = preflight;

      const audioUrl = await storage.signDownload(
        part.storage_bucket,
        part.storage_path!,
        signedUrlTtlSec,
      );

      // The signed URL is a credential; it is passed, never logged.
      const result = await ml.process({
        audioUrl,
        // Opaque to ml/ — correlation only, no authority, no meaning there.
        jobRef: part.id,
        options: {
          // The call's language hint steers the transcriber: an explicit
          // single language narrows the hints; 'mixed' — and any value this
          // worker does not recognise — keeps the historical both-languages
          // hint rather than silently narrowing on unknown vocabulary.
          languageHints: languageHintsFor(part.call_language),
          ...(glossary.length > 0 ? { context: glossary } : {}),
        },
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

      // db/0020: assert the flag once per part, after the segments are in, and
      // only when every one of them carries real word timings. The losing side
      // is a trigger's job — a later correction that blanks a segment's words
      // demotes the part automatically — so this is one-way and needs no
      // cleanup path on our side.
      const hasWordTimestamps =
        mapped.hasWordTimestamps && mapped.segments.every((s) => s.words.length > 0);

      /*
       * ── THE LANDING, in ONE transaction (speed pass, 2026-08-29) ─────────
       *
       * Roster, transcript, the part's own row and the call's duration were
       * four transactions; they are one. Everything this part learned from ml/
       * now becomes visible at the same instant, which also closes a small
       * hole: a crash between the transcript insert and the part update used
       * to leave rows present with `duration_ms` null and a stale status, a
       * half-written part that only the idempotency path repaired.
       *
       * The re-pay window widens slightly and deliberately. The file header
       * notes that a crash between ml/'s response and the database write
       * re-pays for the STT; that window now ends at this COMMIT rather than
       * at the first insert. It is milliseconds of local writes against a
       * transcription measured in minutes, and buying atomicity with it is the
       * better trade — recorded rather than buried, because the header's
       * sentence is now very slightly less true than it was.
       */
      await db.withIdentity(identity, async (tx: SqlTx) => {
        // The roster is built HERE, while ml/'s labels are still in hand. They
        // are local to one response (S1, S2 by first appearance) and mean
        // nothing outside it, so if they are not resolved to call_speaker rows
        // now, the information is gone and link_speakers has nothing to work
        // from.
        const ids = await upsertSpeakers(tx, identity.orgId, part, mapped.segments, result);
        await writeTranscript(tx, identity.orgId, part, mapped.segments, result, ids);
        await tx.unsafe(
          `update echo.call_part
              set duration_ms = $2, status = 'transcribed', has_word_timestamps = $3
            where id = $1`,
          [part.id, result.media.duration_ms, hasWordTimestamps],
        );
        // The call's own duration, from the parts that have landed. db/0004's
        // comment has always said "maintained by the worker as parts land";
        // until now nothing did it, and the api served null on every live row.
        await lifecycle.recomputeCallDuration(identity, part.call_id, tx);
      });

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
 *
 * ── these two transactions MUST NOT be merged (speed pass, 2026-08-29) ──────
 *
 * Every other transaction in this step was batched. This pair was not, and the
 * reason is a race that merging creates rather than exposes.
 *
 * Parts of one call are processed CONCURRENTLY (`config.concurrency` in
 * runner.ts). Today the sequence per part is: commit my status, then read
 * everyone's. Whichever part commits its status last is guaranteed to see all
 * the others already committed when it reads — so at least one part always
 * observes "settled" and enqueues `link_speakers`.
 *
 * Put the write and the read in one transaction and that guarantee is gone.
 * Two parts finishing together can each write their own status and each take
 * their read snapshot before the other COMMITS, so neither sees the other as
 * settled, NEITHER enqueues, and the call sits in `processing` forever with a
 * complete transcript. A stall, not an error — nothing logs, nothing retries,
 * and it needs two parts landing within milliseconds to reproduce.
 *
 * The duplicate-enqueue race in the other direction already exists and is
 * already handled ("link_speakers re-checks state before doing anything"). One
 * of these races is absorbed by design and the other is a silent dead end, so
 * the ordering stays: status committed, THEN the settle question asked.
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

async function hasTranscript(tx: SqlTx, partId: string): Promise<boolean> {
  const rows = await tx.unsafe<{ n: string }>(
    `select count(*)::text as n from echo.transcript_segment where part_id = $1`,
    [partId],
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
export async function upsertSpeakers(
  tx: SqlTx,
  orgId: string,
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

  // Unique per call, and stable across retries: the same part and the same
  // ml/ label always produce the same roster label, so a re-run finds its own
  // row instead of adding a duplicate.
  const rosterLabel = (label: string) => `${label}·${part.idx + 1}`;
  const mlLabelOf = new Map(labels.map((label) => [rosterLabel(label), label]));

  /*
   * ONE statement for the whole roster (speed pass, 2026-08-29).
   *
   * This was a loop issuing one INSERT per label inside the transaction, so a
   * four-voice part paid four round trips to write four small rows. `unnest`
   * turns the roster into two array parameters and one statement.
   *
   * The RETURNING has to carry `label` as well as `id`: the loop knew which
   * label it had just sent, and a set-based statement does not — Postgres is
   * free to return the rows in any order, so pairing them by position would
   * be a silent mis-attribution of one speaker's id to another's words. That
   * is the failure this file already warns about two paragraphs up, and it
   * would be invisible until someone read a transcript. Mapped by name.
   *
   * `on conflict … do update set label = excluded.label` is a deliberate
   * no-op write kept from the original: ON CONFLICT DO NOTHING returns no row
   * for an existing speaker, and a retry needs the ids of rows a previous
   * attempt already created.
   *
   * Safe as one statement because `labels` came from a Set and `rosterLabel`
   * is injective, so no two rows here can share `(call_id, label)`. Postgres
   * raises 21000 ("cannot affect row a second time") on a duplicate within one
   * ON CONFLICT statement rather than silently keeping one — a loud floor
   * under that reasoning rather than a claim resting on it.
   */
  const rows = await tx.unsafe<{ id: string; label: string }>(
    `insert into echo.call_speaker (call_id, org_id, label, channel)
     select $1::uuid, $2::uuid, t.label, t.channel
       from unnest($3::text[], $4::int[]) as t(label, channel)
     on conflict (call_id, label) do update set label = excluded.label
     returning id, label`,
    [
      part.call_id,
      orgId,
      labels.map(rosterLabel),
      labels.map((label) => channelOf.get(label) ?? null),
    ],
  );

  for (const row of rows) {
    const mlLabel = mlLabelOf.get(row.label);
    if (mlLabel) ids.set(mlLabel, row.id);
  }

  return ids;
}

/**
 * Exported for test/e2e/transcript-write.ts ONLY.
 *
 * Not a general entry point — `createPartStep` is the caller that matters, and
 * it is the one that resolves the identity, the roster and the provenance.
 * The export exists because the multi-row rewrite below is a claim about SQL
 * that no fake can check: a fake accepts an invalid statement, an array bound
 * at the wrong type, and a `words` column double-encoded into jsonb strings,
 * all with the same green tick. Rule 10 says the fixture comes from the
 * producer, so the live test drives THIS function rather than a hand-copied
 * transcription of its SQL — two hand-written beliefs about one wire is the
 * thing that keeps shipping.
 */
export async function writeTranscript(
  tx: SqlTx,
  orgId: string,
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

  /*
   * ONE statement for the whole part (speed pass, 2026-08-29).
   *
   * This was one INSERT per segment inside the transaction. A 200-segment part
   * therefore cost 200 round trips to write 200 small rows — the transcript
   * write was network latency almost end to end, and it grows with the length
   * of the call, which is the one dimension a call-intelligence product can
   * expect to grow.
   *
   * Four values are constant for the whole part (call, org, part, provenance)
   * and are sent once as scalars; the six that vary per segment are sent as
   * six arrays and re-joined by `unnest`. Row order out of `unnest` follows
   * array order, but nothing here depends on that: `seq` is carried
   * explicitly, exactly as it was when each row was its own statement.
   *
   * `words` keeps the db/jsonb.ts discipline through the change — see
   * JSONB_ARRAY_PARAM there for why an array is the double-encode bug's
   * favourite hiding place and why `t.words::jsonb` at the call site is safe
   * to leave to a reader (forgetting it is a 42804, not a quiet blob).
   */
  await tx.unsafe(
    `insert into echo.transcript_segment
       (call_id, org_id, part_id, seq, start_ms, end_ms, call_speaker_id, text, words, provenance)
     select $1::uuid, $2::uuid, $3::uuid,
            t.seq, t.start_ms, t.end_ms, t.call_speaker_id, t.text,
            t.words::jsonb, ${JSONB_PARAM(4)}
       from unnest($5::int[], $6::int[], $7::int[], $8::uuid[], $9::text[],
                   ${JSONB_ARRAY_PARAM(10)})
         as t(seq, start_ms, end_ms, call_speaker_id, text, words)`,
    [
      part.call_id,
      orgId,
      part.id,
      toJsonb(provenance),
      segments.map((s) => s.seq),
      segments.map((s) => s.startMs),
      segments.map((s) => s.endMs),
      segments.map((s) => (s.speaker ? (speakerIds.get(s.speaker) ?? null) : null)),
      segments.map((s) => s.text),
      toJsonbArray(segments.map((s) => s.words.map((w) => ({
        w: w.w, s: w.startMs, e: w.endMs,
        ...(w.confidence !== undefined ? { c: w.confidence } : {}),
      })))),
    ],
  );
}
