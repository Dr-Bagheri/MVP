/**
 * The upload surface (Part 5) — how audio ENTERS the pipeline from the
 * product itself. Until now only the E2E harness could do this; the recorder
 * and the file uploader are the first real producers.
 *
 * The recipe is the harness's, promoted to a route (pipeline-live.ts is the
 * producer-side fixture this module must keep agreeing with):
 *
 *   call row (as the CALLER, under RLS) →
 *   bytes to Supabase Storage (service key — M10: objects have no policies,
 *   the signer/uploader IS the wall, and the path never reaches logs) →
 *   call_part row ('uploaded') →
 *   enqueue echo_process_part {callId, ownerId, partId}
 *
 * `ownerId` is stamped HERE, while a genuine caller is present — that is
 * M7's enqueue contract, and it is why this route can never be a worker's
 * job: by the time a worker runs, nobody is present to vouch for identity.
 *
 * Parts follow M2's 30-minute split: the client sends `idx` and `offset_ms`
 * (idx × 30min for browser recordings); this layer checks shape, not policy
 * — duration truth comes from ml/ when the part is transcribed.
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "./errors.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { createQueue, Q_PROCESS_PART } from "../worker/queue.ts";
import type { Identity } from "../agent/types.ts";

export interface UploadsConfig {
  /** Absent = uploads answer 503 with a named reason, never a silent stub. */
  storageUrl?: string | undefined;
  serviceKey?: string | undefined;
}

const BUCKET = "call-audio";

/** audio containers the recorder/uploader can produce, mapped to extensions */
const FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export function createUploadsRepo(db: Db, config: UploadsConfig) {
  const queue = createQueue(db);
  const base = config.storageUrl?.trim().replace(/\/+$/, "");

  return {
    /** True when the deployment can accept audio at all. */
    get configured(): boolean {
      return Boolean(base && config.serviceKey);
    },

    async createCall(
      identity: Identity,
      input: { title?: string | undefined; scope?: string | undefined; source: "web" | "upload" },
    ): Promise<{ id: string }> {
      if (input.scope !== undefined && input.scope !== "private" && input.scope !== "org") {
        throw new ValidationError("scope must be private or org");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.call (org_id, owner_id, title, scope, status, source)
           values ($1, $2, $3, coalesce($4, 'private')::echo.call_scope, 'recording', $5::echo.call_source)
           returning id`,
          [identity.orgId, identity.userId, input.title?.trim() ?? "", input.scope ?? null, input.source],
        ),
      );
      if (!rows[0]) throw new ValidationError("could not create the call");
      return { id: rows[0].id };
    },

    /**
     * One part: bytes → storage → row → queue. Idempotence rides the
     * UNIQUE(call_id, idx) — a retry of the same idx trips 23505 and the
     * caller re-asks rather than double-recording (M7: idempotent against
     * the artifact, and the artifact here is the row).
     */
    async uploadPart(
      identity: Identity,
      callId: string,
      input: { idx: number; offsetMs: number; contentType: string; bytes: Buffer },
    ): Promise<{ part_id: string }> {
      const id = assertUuid(callId, "call id");
      if (!this.configured) {
        throw new ValidationError("uploads are not configured on this deployment",
          { code: "uploads_unconfigured" });
      }
      if (!Number.isInteger(input.idx) || input.idx < 0) {
        throw new ValidationError("idx must be a non-negative integer");
      }
      if (!Number.isInteger(input.offsetMs) || input.offsetMs < 0) {
        throw new ValidationError("offset_ms must be a non-negative integer");
      }
      const ext = FORMATS[input.contentType.split(";")[0]!.trim()];
      if (!ext) {
        throw new ValidationError(
          `unsupported audio type: ${input.contentType} — one of ${Object.keys(FORMATS).join(", ")}`,
          { code: "unsupported_audio" },
        );
      }
      if (input.bytes.length === 0) throw new ValidationError("empty audio body");

      // the call must be the caller's and still writable — RLS scopes the
      // read, and 'recording' is the only state that accepts parts
      const call = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string }>(
          `select id, status from echo.call where id = $1 and deleted_at is null`,
          [id],
        ),
      );
      if (!call[0]) throw new NotFoundError("call not found");
      if (call[0].status !== "recording") {
        throw new ValidationError("this call no longer accepts audio",
          { code: "call_not_recording" });
      }

      /*
       * Bytes first, row second (the purge job's objects-first mirror): an
       * interrupted upload leaves an orphan OBJECT, which costs pennies and
       * purges later — the reverse order leaves a row pointing at nothing,
       * which is a part the pipeline would try to transcribe forever.
       */
      const storagePath = `${id}/${input.idx}-${randomUUID()}.${ext}`;
      const response = await fetch(
        `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${storagePath}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.serviceKey}`,
            apikey: config.serviceKey!,
            "content-type": "application/octet-stream",
          },
          body: new Uint8Array(input.bytes),
        },
      );
      // status only — an error body can echo the path, and the key is in
      // the request (the signer's own discipline)
      if (!response.ok) {
        throw new ValidationError(`audio storage refused the upload (${response.status})`,
          { code: "storage_refused" });
      }

      const part = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.call_part
             (call_id, org_id, idx, offset_ms, storage_bucket, storage_path,
              audio_format, byte_size, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
           returning id`,
          [id, identity.orgId, input.idx, input.offsetMs, BUCKET, storagePath,
           ext, input.bytes.length],
        ),
      );
      if (!part[0]) throw new ValidationError("could not record the part");

      // M7's enqueue contract: ownerId stamped while a genuine caller exists
      await queue.send(Q_PROCESS_PART, {
        callId: id,
        ownerId: identity.userId,
        partId: part[0].id,
      });

      return { part_id: part[0].id };
    },

    /**
     * The FINISH button: recording is over, the pipeline owns it now. Only a
     * 'recording' call flips — finishing twice is a no-op with the same
     * answer, because the end state IS "processing has begun".
     */
    async finish(identity: Identity, callId: string): Promise<{ id: string; status: string }> {
      const id = assertUuid(callId, "call id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string }>(
          `update echo.call set status = 'processing'
            where id = $1 and status = 'recording' and deleted_at is null
            returning id, status`,
          [id],
        ),
      );
      if (rows[0]) return rows[0];
      // already finished, or not ours, or gone — read back to tell the first
      // apart from the others (finishing twice must not read as a fault)
      const existing = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string }>(
          `select id, status from echo.call where id = $1 and deleted_at is null`,
          [id],
        ),
      );
      if (!existing[0]) throw new NotFoundError("call not found");
      return existing[0];
    },
  };
}

export type UploadsRepo = ReturnType<typeof createUploadsRepo>;
