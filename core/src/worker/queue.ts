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

/** Per part. */
export const Q_TRANSCODE = "echo_transcode";
export const Q_VAD = "echo_vad";
export const Q_TRANSCRIBE = "echo_transcribe";
export const Q_DIARIZE = "echo_diarize";
/** Per call, once its parts are done. */
export const Q_LINK_SPEAKERS = "echo_link_speakers";
export const Q_SUMMARIZE = "echo_summarize";

export const PART_QUEUES = [Q_TRANSCODE, Q_VAD, Q_TRANSCRIBE, Q_DIARIZE] as const;
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
  message: JobPayload;
}

export function createQueue(db: Db): Queue {
  return {
    async send(queue, body, delaySec = 0) {
      const rows = await db.withoutIdentity((tx) =>
        tx.unsafe<{ send: string | number }>(`select pgmq.send($1, $2::jsonb, $3) as send`, [
          queue,
          JSON.stringify(body),
          delaySec,
        ]),
      );
      return Number(rows[0]?.send ?? 0);
    },

    async read(queue, vtSec, qty) {
      const rows = await db.withoutIdentity((tx) =>
        tx.unsafe<PgmqRow>(`select msg_id, read_ct, message from pgmq.read($1, $2, $3)`, [
          queue,
          vtSec,
          qty,
        ]),
      );
      return rows.map((row) => ({
        msgId: Number(row.msg_id),
        readCt: Number(row.read_ct),
        body: row.message,
      }));
    },

    async remove(queue, msgId) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.delete($1, $2::bigint)`, [queue, msgId]),
      );
    },

    async archive(queue, msgId) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.archive($1, $2::bigint)`, [queue, msgId]),
      );
    },

    async delay(queue, msgId, vtSec) {
      await db.withoutIdentity((tx) =>
        tx.unsafe(`select pgmq.set_vt($1, $2::bigint, $3)`, [queue, msgId, vtSec]),
      );
    },
  };
}
