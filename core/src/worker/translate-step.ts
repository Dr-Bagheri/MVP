/**
 * The TRANSLATE step (2026-09-06, C4): audio in, translated lines out.
 *
 * One message per (call, language). The job runs as the call's OWNER
 * (resolveJobIdentity — the payload carries the owner, written at enqueue
 * time while a real caller was present), signs each part's audio, asks ml/
 * to translate it through the transcriber, places the units on the stored
 * lines (translation-mapping.ts), writes the rows and marks the request
 * ready.
 *
 * FAILURE IS THE REQUEST'S, NEVER THE CALL'S. A translation that cannot be
 * made leaves a ready record exactly as ready as it was: a provider refusal
 * or a file past the ceiling marks the request `failed` with its type and
 * ENDS the step normally; a transient fault (ml/ unreachable, a timeout) is
 * rethrown for the runner's retry while the status stays queued — until the
 * third delivery, when it too is written down as failed rather than sent to
 * the dead-letter sink, whose per-call branch would fail the CALL.
 */
import type { Db, SqlTx } from "../db/identity.ts";
import type { TranslationsRepo } from "../api/translations.ts";
import { resolveJobIdentity } from "./job-identity.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { mlTimeoutFor, type MlClient } from "./ml-client.ts";
import { isTranslatePayload, Q_TRANSLATE, type QueuePayload } from "./queue.ts";
import { StepError, type StepHandler } from "./runner.ts";
import type { StorageSigner } from "./steps.ts";
import { assignUnitsToSegments, type SegmentSpan } from "./translation-mapping.ts";

export interface TranslateStepOptions {
  db: Db;
  ml: MlClient;
  storage: StorageSigner;
  lifecycle: Lifecycle;
  translations: TranslationsRepo;
  signedUrlTtlSec?: number;
  mlTimeoutMs?: number;
  /** the delivery on which a transient fault is written down as final */
  finalAttempt?: number;
}

export function createTranslateStep({
  db, ml, storage, lifecycle, translations,
  signedUrlTtlSec = 60 * 60,
  mlTimeoutMs = 20 * 60 * 1000,
  finalAttempt = 3,
}: TranslateStepOptions): StepHandler {
  return {
    name: "translate",
    queue: Q_TRANSLATE,

    async handle(payload: QueuePayload, { attempt, log }) {
      if (!isTranslatePayload(payload)) {
        throw new StepError("bad_payload", "translate message carries no translate payload", false);
      }
      const identity = await resolveJobIdentity(db, { callId: payload.callId, ownerId: payload.ownerId });
      const base = { call_id: payload.callId, language: payload.language };

      try {
        const parts = await lifecycle.partsOfCall(identity, payload.callId);
        const spans = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<SegmentSpan & { part_id: string | null }>(
            `select id, part_id, start_ms, end_ms from echo.transcript_segment
              where call_id = $1 order by start_ms, seq`,
            [payload.callId]));
        if (spans.length === 0) {
          await translations.markFailed(identity, payload.callId, payload.language, "no_transcript");
          log.warn(base, "nothing to translate: the call has no lines");
          return;
        }

        const rows: { segment_id: string; text: string }[] = [];
        let model = "";
        for (const part of parts) {
          if (part.missing || !part.storage_path) continue;
          const url = await storage.signDownload(part.storage_bucket, part.storage_path, signedUrlTtlSec);
          const result = await ml.translate({
            audioUrl: url,
            targetLanguage: payload.language,
            languageHints: ["fa", "en"],
            jobRef: part.id,
          }, { timeoutMs: mlTimeoutFor(part.duration_ms, mlTimeoutMs) });
          model = result.model;
          /* the part's own lines; rows written before part_id was kept fall
             back to the lines inside the part's span */
          const own = spans.filter((s) => s.part_id === part.id);
          const window = own.length > 0 ? own : spans.filter((s) =>
            s.start_ms >= part.offset_ms && (part.duration_ms === null || s.start_ms < part.offset_ms + part.duration_ms));
          for (const [segment_id, text] of assignUnitsToSegments(result.units, window, part.offset_ms)) {
            rows.push({ segment_id, text });
          }
        }

        await translations.writeSegments(identity, payload.callId, payload.orgId, payload.language, rows);
        await translations.markReady(identity, payload.callId, payload.language, model || "unknown");
        log.info({ ...base, lines: rows.length }, "translation ready");
      } catch (error) {
        const retryable = (error as { retryable?: boolean }).retryable === true;
        const errorType = (error as { errorType?: string }).errorType ?? "translate_failed";
        if (retryable && attempt < finalAttempt) {
          log.warn({ ...base, error_type: errorType, attempt }, "translation deferred; the request stays queued");
          throw error;
        }
        await translations.markFailed(identity, payload.callId, payload.language, errorType);
        log.warn({ ...base, error_type: errorType, attempt }, "translation failed; the record is untouched");
      }
    },
  };
}
