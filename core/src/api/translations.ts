/**
 * The transcript's TRANSLATION as rows (db/0201; 2026-09-06, C4 — user
 * directive: "run translate_record through Soniox instead of a language
 * model").
 *
 * A translation is a JOB and an ARTIFACT now, not a model call whose text
 * lived in the page that asked: the request row (call, language) carries
 * its status, the worker translates the AUDIO through the transcriber and
 * writes one text per line, and every reader of the call reads them beside
 * the transcript. The wall is the call's own (can_read_call): a reader may
 * ask, only the owner's job writes, the agent role reads.
 *
 * Idempotent on purpose: asking for a language that is READY answers ready
 * and enqueues nothing; asking while QUEUED answers queued and enqueues
 * nothing new; asking after FAILED requeues — a failure is a reason to try
 * again, not a state to be stuck in.
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import { TRANSLATION_STATUSES, type TranslationStatus } from "./vocabulary.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";
import { Q_TRANSLATE, type Queue } from "../worker/queue.ts";

export interface CallTranslation {
  call_id: string;
  language: string;
  /** `none` = never asked; otherwise the request's own status */
  status: TranslationStatus | "none";
  requested_at: string | null;
  finished_at: string | null;
  error_type: string | null;
  /** one translated text per segment id — empty until ready */
  segments: { segment_id: string; text: string }[];
}

/** a short language tag — the provider's own spelling, lower-case, no region */
export function translationLanguage(value: unknown): string {
  const tag = typeof value === "string" ? value.trim().toLowerCase() : "en";
  if (!/^[a-z]{2,3}$/.test(tag)) throw new ValidationError("target must be a two- or three-letter language tag", { code: "bad_language" });
  return tag;
}

export function createTranslationsRepo(db: Db) {
  return {
    /**
     * Ask. Reads the call under the caller's identity (404 past the wall),
     * upserts the request row, and enqueues the job — as the CALL's owner,
     * whose wall decides what the worker may read (M7). Answers the status
     * the row has after the ask.
     */
    async request(
      identity: Identity, callId: string, language: string, queue: Queue,
    ): Promise<{ status: TranslationStatus; language: string }> {
      const id = assertUuid(callId, "call id");
      const call = (await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; owner_id: string; org_id: string }>(
          `select c.id, c.owner_id, c.org_id from echo.call c where c.id = $1`, [id])))[0];
      if (!call) throw new NotFoundError("no such call");

      const row = (await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ status: TranslationStatus; enqueue: boolean }>(
          `insert into echo.call_translation (call_id, language, org_id, requested_by)
           values ($1, $2, $3, $4)
           on conflict (call_id, language) do update
             set status       = case when echo.call_translation.status = 'ready' then 'ready' else 'queued' end,
                 requested_by = excluded.requested_by,
                 requested_at = case when echo.call_translation.status = 'failed' then now() else echo.call_translation.requested_at end,
                 error_type   = case when echo.call_translation.status = 'failed' then null else echo.call_translation.error_type end
           returning status,
                     /* enqueue only when this ask moved the row to queued or created it —
                        a request already queued has its job in flight */
                     (xmax = 0 or status = 'queued') as enqueue`,
          [id, language, call.org_id, identity.userId])))[0]!;

      if (row.status === "queued" && row.enqueue) {
        await queue.send(Q_TRANSLATE, {
          kind: "translate", callId: id, ownerId: call.owner_id, orgId: call.org_id,
          language, requestedBy: identity.userId,
        });
      }
      return { status: row.status, language };
    },

    /** the request and, when ready, one text per segment — for the caller's own view of the call */
    async read(identity: Identity, callId: string, language: string): Promise<CallTranslation> {
      const id = assertUuid(callId, "call id");
      return db.withIdentity(identity, async (tx: SqlTx) => {
        const call = (await tx.unsafe<{ id: string }>(`select c.id from echo.call c where c.id = $1`, [id]))[0];
        if (!call) throw new NotFoundError("no such call");
        const request = (await tx.unsafe<{ status: TranslationStatus; requested_at: string; finished_at: string | null; error_type: string | null }>(
          `select status, requested_at, finished_at, error_type
             from echo.call_translation where call_id = $1 and language = $2`, [id, language]))[0];
        const rows = request?.status === "ready"
          ? await tx.unsafe<{ segment_id: string; text: string }>(
              `select tt.segment_id, tt.text
                 from echo.transcript_translation tt
                 join echo.transcript_segment s on s.id = tt.segment_id
                where tt.call_id = $1 and tt.language = $2
                order by s.start_ms, s.seq`, [id, language])
          : [];
        return {
          call_id: id,
          language,
          status: request?.status ?? "none",
          requested_at: request?.requested_at ?? null,
          finished_at: request?.finished_at ?? null,
          error_type: request?.error_type ?? null,
          segments: rows.map((r) => ({ segment_id: r.segment_id, text: r.text })),
        };
      });
    },

    /** the worker's half — as the call's owner: the lines, then the status */
    async writeSegments(
      identity: Identity, callId: string, orgId: string, language: string,
      rows: readonly { segment_id: string; text: string }[],
    ): Promise<void> {
      if (rows.length === 0) return;
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `insert into echo.transcript_translation (segment_id, language, call_id, org_id, text)
           select t.segment_id, $3, $1::uuid, $2::uuid, t.text
             from unnest($4::uuid[], $5::text[]) as t(segment_id, text)
           on conflict (segment_id, language) do update set text = excluded.text`,
          [callId, orgId, language, rows.map((r) => r.segment_id), rows.map((r) => r.text)],
        ));
    },

    async markReady(identity: Identity, callId: string, language: string, model: string): Promise<void> {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call_translation
              set status = 'ready', finished_at = now(), error_type = null, model = $3
            where call_id = $1 and language = $2`,
          [callId, language, model],
        ));
    },

    async markFailed(identity: Identity, callId: string, language: string, errorType: string): Promise<void> {
      await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe(
          `update echo.call_translation
              set status = 'failed', finished_at = now(), error_type = $3
            where call_id = $1 and language = $2`,
          [callId, language, errorType.slice(0, 80)],
        ));
    },
  };
}

export type TranslationsRepo = ReturnType<typeof createTranslationsRepo>;
export { TRANSLATION_STATUSES };
