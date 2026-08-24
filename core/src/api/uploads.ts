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
import { createStorageSigner } from "../storage/signer.ts";
import { createQueue, Q_LINK_SPEAKERS, Q_PROCESS_PART, Q_SUMMARIZE } from "../worker/queue.ts";
import { SUMMARY_INSTRUCTION_MAX, SUMMARY_TEMPLATES } from "./vocabulary.ts";
import { hasProvisionalTranscript } from "../db/capabilities.ts";
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
      input: {
        title?: string | undefined;
        scope?: string | undefined;
        source: "web" | "upload";
        language?: string | undefined;
      },
    ): Promise<{ id: string }> {
      if (input.scope !== undefined && input.scope !== "private" && input.scope !== "org") {
        throw new ValidationError("scope must be private or org");
      }
      /*
       * The LANGUAGE HINT (user directive, 2026-08-22): set at creation,
       * immutable after (the 0011 guard), read by the worker to steer the
       * transcriber's language_hints. `mixed` means "both fa and en" and is
       * what the web recorder sends by default — it preserves the
       * both-languages hint every call got before this field was consumable.
       * The column default stays 'fa' for producers that never send one.
       */
      if (
        input.language !== undefined &&
        input.language !== "fa" && input.language !== "en" && input.language !== "mixed"
      ) {
        throw new ValidationError("language must be fa, en or mixed");
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.call (org_id, owner_id, title, scope, status, source, language)
           values ($1, $2, $3, coalesce($4, 'private')::echo.call_scope, 'recording', $5::echo.call_source, coalesce($6, 'fa'))
           returning id`,
          [
            identity.orgId,
            identity.userId,
            input.title?.trim() ?? "",
            input.scope ?? null,
            input.source,
            input.language ?? null,
          ],
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
     * Mint a signed upload URL for one part — the browser PUTs the bytes to
     * storage DIRECTLY, then calls registerPart.
     *
     * Why this exists beside uploadPart: the web app is served by Vercel,
     * whose request-body ceiling (~4.5MB) is smaller than one 30-minute
     * part, so bytes can never ride the BFF in production. This is M10's
     * posture verbatim — "the missing piece is a signer, not a policy":
     * the URL is a single-object, expiring credential minted per operation,
     * and the service key never leaves this process.
     */
    async signPart(
      identity: Identity,
      callId: string,
      input: { idx: number; contentType: string },
    ): Promise<{ upload_url: string; path: string; content_type: string }> {
      const id = assertUuid(callId, "call id");
      if (!this.configured) {
        throw new ValidationError("uploads are not configured on this deployment",
          { code: "uploads_unconfigured" });
      }
      if (!Number.isInteger(input.idx) || input.idx < 0) {
        throw new ValidationError("idx must be a non-negative integer");
      }
      const ext = FORMATS[input.contentType.split(";")[0]!.trim()];
      if (!ext) {
        throw new ValidationError(
          `unsupported audio type: ${input.contentType} — one of ${Object.keys(FORMATS).join(", ")}`,
          { code: "unsupported_audio" },
        );
      }
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

      const storagePath = `${id}/${input.idx}-${randomUUID()}.${ext}`;
      const response = await fetch(
        `${base}/storage/v1/object/upload/sign/${encodeURIComponent(BUCKET)}/${storagePath}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.serviceKey}`,
            apikey: config.serviceKey!,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      if (!response.ok) {
        // status only — the signer's own discipline (a body can echo paths)
        throw new ValidationError(`audio storage refused to sign (${response.status})`,
          { code: "storage_refused" });
      }
      const signed = (await response.json()) as { url?: string };
      if (!signed.url) {
        throw new ValidationError("audio storage answered without a URL",
          { code: "storage_refused" });
      }
      // storage answers a relative path under /storage/v1
      return {
        upload_url: `${base}/storage/v1${signed.url.replace(/^\/storage\/v1/, "")}`,
        path: storagePath,
        content_type: input.contentType,
      };
    },

    /**
     * The second half of the signed flow: the bytes are in storage, now the
     * part becomes REAL — row + enqueue, same tail as uploadPart.
     *
     * The path is caller-supplied but caged: it must sit under this call's
     * own prefix (a caller can only ever register objects the signer minted
     * for their call), and the object's existence and size are read from
     * storage with the service key — byte_size is never taken on faith. The
     * worst a hostile caller can do is register their own audio twice under
     * two idx values, tripping UNIQUE or double-transcribing their own call.
     */
    async registerPart(
      identity: Identity,
      callId: string,
      input: { idx: number; offsetMs: number; path: string },
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
      if (!input.path.startsWith(`${id}/`) || input.path.includes("..")) {
        throw new ValidationError("path does not belong to this call");
      }
      const ext = input.path.split(".").pop() ?? "";
      if (!Object.values(FORMATS).includes(ext)) {
        throw new ValidationError("path has no recognized audio extension");
      }
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

      // the object must EXIST before the row does — a row pointing at
      // nothing is a part the pipeline retries forever (the same ordering
      // uploadPart enforces, verified here instead of performed here)
      const head = await fetch(
        `${base}/storage/v1/object/${encodeURIComponent(BUCKET)}/${input.path}`,
        {
          method: "HEAD",
          headers: {
            authorization: `Bearer ${config.serviceKey}`,
            apikey: config.serviceKey!,
          },
        },
      );
      if (!head.ok) {
        throw new ValidationError("no uploaded audio at that path",
          { code: "object_missing" });
      }
      const byteSize = Number(head.headers.get("content-length") ?? 0);
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new ValidationError("uploaded audio is empty", { code: "object_missing" });
      }

      const part = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `insert into echo.call_part
             (call_id, org_id, idx, offset_ms, storage_bucket, storage_path,
              audio_format, byte_size, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded')
           returning id`,
          [id, identity.orgId, input.idx, input.offsetMs, BUCKET, input.path,
           ext, byteSize],
        ),
      );
      if (!part[0]) throw new ValidationError("could not record the part");

      await queue.send(Q_PROCESS_PART, {
        callId: id,
        ownerId: identity.userId,
        partId: part[0].id,
      });

      return { part_id: part[0].id };
    },

    /**
     * PLAYBACK (the player's other half — audio has entered, now it comes
     * back OUT): short-lived signed download URLs for every part the caller
     * may see. RLS scopes the read (the join to `call` is what makes an
     * invisible or deleted call answer "no audio" identically to a call
     * with none); the signer is the wall (M10), and each URL expires while
     * an incident would still be small.
     */
    async playback(
      identity: Identity,
      callId: string,
    ): Promise<{ parts: { idx: number; offset_ms: number; url: string }[] }> {
      const id = assertUuid(callId, "call id");
      if (!this.configured) {
        throw new ValidationError("uploads are not configured on this deployment",
          { code: "uploads_unconfigured" });
      }
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ idx: number; offset_ms: number; storage_bucket: string; storage_path: string }>(
          `select p.idx, p.offset_ms, p.storage_bucket, p.storage_path
             from echo.call_part p
             join echo.call c on c.id = p.call_id
            where p.call_id = $1 and c.deleted_at is null
            order by p.idx`,
          [id],
        ),
      );
      // no visible parts: no such call, not the caller's, or nothing
      // uploaded yet — one answer, deliberately (the RLS fold)
      if (rows.length === 0) throw new NotFoundError("no audio for that call");
      const signer = createStorageSigner({ url: base!, serviceKey: config.serviceKey! });
      const parts = await Promise.all(
        rows.map(async (row) => ({
          idx: Number(row.idx),
          offset_ms: Number(row.offset_ms),
          url: await signer.signDownload(row.storage_bucket, row.storage_path, 3600),
        })),
      );
      return { parts };
    },

    /**
     * The FINISH button: recording is over, the pipeline owns it now. Only a
     * 'recording' call flips — finishing twice is a no-op with the same
     * answer, because the end state IS "processing has begun".
     */
    async finish(
      identity: Identity,
      callId: string,
      opts: { provisional?: string } = {},
    ): Promise<{ id: string; status: string }> {
      const id = assertUuid(callId, "call id");
      /*
       * M40 (0089): the live-caption text rides the finish — written in the
       * SAME update that flips recording→processing, so it can only ever
       * land on the finish transition, once, by whoever may finish. Bounded
       * and capability-gated; oversize or un-migrated silently drops the
       * preview, never the finish (a rough copy must not cost the real one).
       */
      const provisional = opts.provisional?.trim() || undefined;
      const canPreview =
        provisional !== undefined
        && provisional.length <= 200_000
        && (await hasProvisionalTranscript(db));
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string }>(
          `update echo.call set status = 'processing'
                  ${canPreview ? ", provisional_transcript = $2" : ""}
            where id = $1 and status = 'recording' and deleted_at is null
            returning id, status`,
          canPreview ? [id, provisional] : [id],
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

    /**
     * RETRY a FAILED call (user directive, 2026-08-22: "we got the voice —
     * add an option to retry the processing phase"). The pipeline was
     * designed resumable (M7: every step idempotent against its artifact;
     * dead-letter semantics: call-step failure = resumable fail) — this is
     * the missing DOOR, not a new mechanism.
     *
     * The resume point comes from the ARTIFACTS, never a flag: parts that
     * still lack transcripts (and are not marked missing) re-run
     * process_part; when every surviving part has its transcript, the call
     * re-enters at link_speakers, which chains to summarize as always.
     * Steps re-check their artifacts on arrival, so a retry can never
     * duplicate a transcript or a speaker roster.
     *
     * The JOB runs as the CALL'S OWNER (M3) — payload.ownerId is the
     * call's owner_id, not the retrier: an admin pressing retry must not
     * lend the pipeline their wider read. Status moves failed→processing
     * here; the 0033 guard clears failure_reason on that transition.
     */
    async retry(
      identity: Identity,
      callId: string,
    ): Promise<{ id: string; status: string; resumed_at: "parts" | "summary"; parts: number }> {
      const id = assertUuid(callId, "call id");
      const call = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string; owner_id: string }>(
          `select id, status, owner_id from echo.call
            where id = $1 and deleted_at is null`,
          [id],
        ),
      );
      if (!call[0]) throw new NotFoundError("call not found");
      if (call[0].status !== "failed") {
        throw new ValidationError("only a failed call can be retried",
          { code: "not_failed", params: { status: call[0].status } });
      }
      const owner = call[0].owner_id;

      // which parts never produced their transcript? (missing parts are
      // the recorded gaps — retrying them would retry the loss, not fix it)
      const bare = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `select p.id from echo.call_part p
            where p.call_id = $1
              and p.missing = false
              and p.storage_path is not null
              and not exists (
                select 1 from echo.transcript_segment s where s.part_id = p.id
              )`,
          [id],
        ),
      );

      // 'processing' either way — honest ("back in the pipeline"); the
      // link step advances it to 'summarizing' itself when it runs
      const moved = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call set status = 'processing'
            where id = $1 and status = 'failed'
            returning id`,
          [id],
        ),
      );
      // a concurrent retry won the race — same intent, one answer, no fault
      if (!moved[0]) {
        return { id, status: "processing", resumed_at: bare.length > 0 ? "parts" : "summary", parts: 0 };
      }

      if (bare.length > 0) {
        for (const part of bare) {
          await queue.send(Q_PROCESS_PART, { callId: id, ownerId: owner, partId: part.id });
        }
        return { id, status: "processing", resumed_at: "parts", parts: bare.length };
      }
      await queue.send(Q_LINK_SPEAKERS, { callId: id, ownerId: owner });
      return { id, status: "processing", resumed_at: "summary", parts: 0 };
    },

    /**
     * REGENERATE a summary (user directive, 2026-08-23): a new VERSION on
     * the existing ladder — versions are never edited in place, so this is
     * an enqueue, not a write. Optionally shaped by a template from the
     * ruled list and/or the requester's own instruction (bounded like every
     * reason field; it steers structure, it is not content).
     *
     * Ready calls only: a failed call has the retry door, and a call still
     * in the pipeline will summarize on its own. Status moves
     * ready→summarizing so every table and page that already polls the
     * pipeline sees this run the same way. The JOB runs as the CALL'S
     * OWNER (M3), exactly like retry.
     */
    async resummarize(
      identity: Identity,
      callId: string,
      opts: { template?: string; instruction?: string; figures?: boolean },
    ): Promise<{ id: string; status: string }> {
      const id = assertUuid(callId, "call id");
      if (opts.template !== undefined
        && !(SUMMARY_TEMPLATES as readonly string[]).includes(opts.template)) {
        throw new ValidationError("unknown summary template",
          { code: "unknown_template", params: { template: opts.template } });
      }
      const instruction = opts.instruction?.trim() || undefined;
      if (instruction && instruction.length > SUMMARY_INSTRUCTION_MAX) {
        throw new ValidationError("instruction too long",
          { code: "instruction_too_long", params: { max: SUMMARY_INSTRUCTION_MAX } });
      }
      const call = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string; status: string; owner_id: string }>(
          `select id, status, owner_id from echo.call
            where id = $1 and deleted_at is null`,
          [id],
        ),
      );
      if (!call[0]) throw new NotFoundError("call not found");
      if (call[0].status !== "ready") {
        throw new ValidationError("only a ready call can be re-summarized",
          { code: "not_ready", params: { status: call[0].status } });
      }
      const moved = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<{ id: string }>(
          `update echo.call set status = 'summarizing'
            where id = $1 and status = 'ready'
            returning id`,
          [id],
        ),
      );
      // a concurrent regenerate won the race — same intent, one answer
      if (moved[0]) {
        await queue.send(Q_SUMMARIZE, {
          callId: id,
          ownerId: call[0].owner_id,
          ...(opts.template ? { template: opts.template } : {}),
          ...(instruction ? { instruction } : {}),
          ...(opts.figures ? { figures: true } : {}),
        });
      }
      return { id, status: "summarizing" };
    },
  };
}

export type UploadsRepo = ReturnType<typeof createUploadsRepo>;
