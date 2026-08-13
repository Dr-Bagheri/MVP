/**
 * The purge process. Runs one pass, reports, exits.
 *
 * One-shot rather than a loop, because a purge is a scheduled job and a
 * process that exits is one a scheduler can reason about: no drift, no
 * overlapping runs, and the exit code is the result. It is idempotent
 * end-to-end, so re-running after any failure is always safe and is the
 * intended recovery.
 *
 * It connects as `echo_purge` and attaches NO identity — deliberately, and it
 * is the only process in this product that does. Every other path resolves an
 * actor because it acts on someone's behalf; this one is maintenance, and its
 * policies are written against the window (`deleted_at is not null and
 * purge_after <= now()`) rather than against an actor. The wall here is the
 * predicate, not the caller.
 */
import { pathToFileURL } from "node:url";
import pino from "pino";
import postgres from "postgres";

import type { SqlTx } from "../db/identity.ts";
import { normalizeDbUrl } from "../worker/main.ts";
import { runPurge, type PurgeStorage } from "./purge.ts";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { svc: "purge" },
  // A purge names calls and parts. It never names their content.
  redact: { paths: ["text", "words", "url", "authorization"], censor: "[redacted]" },
});

function requireEnv(name: string, why: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`purge: ${name} is required — ${why}`);
  return value;
}

function int(name: string, dflt: number): number {
  const raw = process.env[name];
  if (!raw) return dflt;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`purge: ${name} must be a positive number`);
  return Math.floor(value);
}

/**
 * Is this failure "the object is already gone"?
 *
 * Measured against the real API, not assumed: deleting a missing object
 * answers **HTTP 400**, with the 404 buried in the body —
 *
 *   400 Bad Request
 *   {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
 *
 * The transport status says "your request was malformed" and the body says
 * "the thing is not there", and those want opposite responses: the first is a
 * bug to fix, the second is the expected state of a retry. This function is
 * the whole reason the distinction is drawn in one place — an earlier version
 * of this file checked `response.status === 404`, which is never true here, so
 * the already-gone path was dead code that read as handled.
 *
 * **The same wrapping hides a dead credential** (found by Backend 3 while
 * verifying the rotated key). A rejected key answers:
 *
 *   400 Bad Request
 *   {"statusCode":"403","error":"Unauthorized","code":"AccessDenied"}
 *
 * Two completely different situations arriving as the same HTTP status, and
 * the dangerous one is not the obvious one: a rule any looser than the three
 * fields below — "400 means gone", say — would read an expired key as "the
 * object was already deleted", delete the row, and leave the audio in the
 * bucket with nothing pointing at it. That is the purge failing in the one
 * direction it must never fail, silently, on every call it touches.
 *
 * So the classification is by the body's own code, and the code travels into
 * the error for the operator. Reporting `(400)` alone would send whoever is
 * paged at 4am to look at our request payload when the answer is that the key
 * is dead. `message` is still never read and the body is never logged — that
 * is where the customer's path lives.
 */
export interface StorageFailure {
  /** True only for "the object is not there" — the one failure that is success. */
  gone: boolean;
  /** The provider's own error code, for the operator. Never the message. */
  code: string | null;
}

export async function classifyStorageFailure(response: Response): Promise<StorageFailure> {
  if (response.status === 404) return { gone: true, code: "NotFound" };

  let body: { statusCode?: unknown; error?: unknown; code?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // A failure we cannot read is a failure. Never optimistic here: guessing
    // "gone" would delete the row and strand the audio.
    return { gone: false, code: null };
  }

  const code = typeof body.code === "string" ? body.code : null;
  const gone =
    response.status === 400 &&
    (body.statusCode === "404" || body.error === "not_found" || body.code === "NoSuchKey");

  return { gone, code };
}

/**
 * Supabase Storage removal.
 *
 * `remove` on a path that is already gone is SUCCESS, not an error — and this
 * is not a nicety. Objects are deleted BEFORE rows precisely so that an
 * interrupted run leaves a row whose object is missing rather than an object
 * with no row pointing at it. That deliberate intermediate state is reached by
 * every partial failure, so if it jammed the purge, the ordering would have
 * built the deadlock it exists to prevent: the call would be retried forever,
 * never deleted, and the 30-day promise quietly unkept.
 */
export function createStorage(url: string, serviceKey: string): PurgeStorage {
  const base = url.replace(/\/+$/, "");
  return {
    async remove(bucket: string, path: string): Promise<boolean> {
      const response = await fetch(`${base}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      });
      if (response.ok) return true;

      const failure = await classifyStorageFailure(response);
      if (failure.gone) return false;

      // Status AND the provider's code — never the message, never the path.
      // The code is what distinguishes "our request is wrong" from "the key is
      // dead", and both arrive here as a 400.
      throw Object.assign(
        new Error(
          `storage delete failed (${response.status}${failure.code ? ` ${failure.code}` : ""})`,
        ),
        { status: response.status, code: failure.code },
      );
    },
  };
}

export async function main(): Promise<number> {
  const dbUrl = normalizeDbUrl(
    requireEnv("DATABASE_URL_PURGE", "the purge runs as echo_purge, the only role holding DELETE"),
  );

  // REFUSES to start without storage configuration, rather than purging rows
  // and leaving the audio. Deleting the row is deleting the map to the object;
  // doing that with no way to delete the object is how a recording survives a
  // purge invisibly — the exact failure the objects-first ordering exists to
  // prevent. A purge that cannot keep the whole promise must not keep half.
  const storage = createStorage(
    requireEnv("SUPABASE_URL", "the audio must be deleted alongside the rows, not after them"),
    requireEnv("SUPABASE_SERVICE_KEY", "the audio must be deleted alongside the rows, not after them"),
  );

  const sql = postgres(dbUrl, { max: 2 });
  const begin = <T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> =>
    sql.begin(fn as never) as unknown as Promise<T>;

  try {
    const result = await runPurge(
      begin,
      storage,
      {
        maxCallsPerRun: int("PURGE_MAX_CALLS", 500),
        batchSize: int("PURGE_BATCH_SIZE", 25),
      },
      log,
    );

    log.info(result, result.refused ? "purge refused" : "purge complete");
    // A refusal is not a success. The exit code says so, because a scheduler
    // reads exit codes and nobody reads a log at 4am.
    return result.refused ? 2 : 0;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      log.error({ err: (error as Error).message }, "purge failed to run");
      process.exit(1);
    });
}
