/**
 * The work plane (M7, db/0017): one queue per DAG step, one step per message.
 *
 * Queue plumbing is the sanctioned use of `withoutIdentity` — pgmq's tables
 * are not product tables, carry no `org_id`, and no RLS policy applies to
 * them. Everything a step then DOES with the payload runs under an identity
 * resolved from that payload (`identityForJob`), so the wall is never skipped:
 * reading an envelope is not reading a call.
 */
import type { Db } from "../db/identity.ts";
import { JSONB_PARAM, toJsonb } from "../db/jsonb.ts";

/**
 * Per part — ONE queue (db/0019, M7 amendment).
 *
 * 0017 created four (`echo_transcode`, `echo_vad`, `echo_transcribe`,
 * `echo_diarize`) to mirror M7's named steps, but ml/'s `/process` performs
 * all four in a single synchronous call, so three of them would have had no
 * consumer. Three no-op queues read like a pipeline and behave like a lie, so
 * they were dropped rather than left standing.
 */
export const Q_PROCESS_PART = "echo_process_part";
/** Per call, once its parts are done. */
export const Q_LINK_SPEAKERS = "echo_link_speakers";
export const Q_SUMMARIZE = "echo_summarize";

export const PART_QUEUES = [Q_PROCESS_PART] as const;
export const CALL_QUEUES = [Q_LINK_SPEAKERS, Q_SUMMARIZE] as const;
export const ALL_QUEUES = [...PART_QUEUES, ...CALL_QUEUES] as const;

export type QueueName = (typeof ALL_QUEUES)[number];

/**
 * Every message carries the call AND the owner it must run as, written at
 * enqueue time when a real caller was present. The worker does NOT look the
 * owner up with a privileged read — wanting to bypass RLS "just to find the
 * owner" is how service-account creep starts (M3/M4).
 */
export interface JobPayload {
  callId: string;
  ownerId: string;
  /** Absent on the per-call steps. */
  partId?: string;
}

export interface QueueMessage<T = JobPayload> {
  msgId: number;
  /** pgmq's delivery count — the attempt number, with no state of our own. */
  readCt: number;
  body: T;
}

export interface Queue {
  send(queue: QueueName, body: JobPayload, delaySec?: number): Promise<number>;
  read(queue: QueueName, vtSec: number, qty: number): Promise<QueueMessage[]>;
  /** Done: drop it. */
  remove(queue: QueueName, msgId: number): Promise<void>;
  /** Dead-letter: keep it, out of the way, for a human to look at. */
  archive(queue: QueueName, msgId: number): Promise<void>;
  /** Retry later: push the visibility timeout out by the backoff. */
  delay(queue: QueueName, msgId: number, vtSec: number): Promise<void>;
}

interface PgmqRow {
  msg_id: string | number;
  read_ct: string | number;
  /**
   * A STRING, not an object. `pgmq.read()` returns SETOF a record type, and
   * the driver does not infer jsonb through it the way it does for a plain
   * column — so the payload arrives as raw JSON text. Verified against the
   * real database; a stubbed queue hands back the object you gave it and hides
   * this completely, which is how the worker "worked" in 39 tests while
   * silently seeing `partId: undefined` on every job.
   */
  message: JobPayload | string;
}

function parsePayload(message: JobPayload | string): JobPayload {
  return typeof message === "string" ? (JSON.parse(message) as JobPayload) : message;
}

// EVERY pgmq argument is cast explicitly. `pgmq.send` is overloaded on its
// third parameter — `integer` (a delay in seconds) and `timestamptz` (send at
// a moment) — so an untyped parameter is ambiguous and Postgres refuses with
// "function pgmq.send(unknown, jsonb, unknown) is not unique". A stubbed queue
// cannot reproduce that; only a real database can.
export function createQueue(db: Db): Queue {
  return {
    async send(queue, body, delaySec = 0) {
      const rows = await db.withoutIdentity((tx) =>
        // Through the shared helper (db/jsonb.ts): exactly one encode, and the
        // `::text::jsonb` cast travels with the value rather than being a
        // convention someone has to remember. Passing `JSON.stringify(body)`
        // to a bare `::jsonb` stored a jsonb *string* here, which is why every
        // job once saw `partId: undefined`.
        tx.unsafe<{ send: string | number }>(
          `select pgmq.send($1::text, ${JSONB_PARAM(2)}, $3::integer) as send`,
          [queue, toJsonb(body), delaySec],
        ),
      );
      return Number(rows[0]?.send ?? 0);
    },

    async read(queue, vtSec, qty) {
      const rows = await db.withoutIdentity((tx) =>
        tx.unsafe<PgmqRow>(
          `select msg_id, read_ct, message from pgmq.read($1::text, $2::integer, $3::integer)`,
          [queue, vtSec, qty],
        ),
      );
      return rows.map((row) => ({
        msgId: Number(row.msg_id),
        readCt: Number(row.read_ct),
        body: parsePayload(row.message),
      }));
    },

    async remove(queue, msgId) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.delete($1::text, $2::bigint)`, [queue, msgId]),
      );
    },

    async archive(queue, msgId) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.archive($1::text, $2::bigint)`, [queue, msgId]),
      );
    },

    async delay(queue, msgId, vtSec) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.set_vt($1::text, $2::bigint, $3::integer)`, [queue, msgId, vtSec]),
      );
    },
  };
}
