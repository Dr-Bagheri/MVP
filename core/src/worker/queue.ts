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

/** M35 signals: rule firings, each run AS the owner (db/0074). */
export const Q_AGENT_RULES = "echo_agent_rules";

/** M41: one message advances exactly ONE workflow step (W11, db/0104). */
export const Q_WORKFLOW_STEP = "echo_workflow_step";

export const PART_QUEUES = [Q_PROCESS_PART] as const;
export const CALL_QUEUES = [Q_LINK_SPEAKERS, Q_SUMMARIZE] as const;
export const ALL_QUEUES = [
  ...PART_QUEUES, ...CALL_QUEUES, Q_AGENT_RULES, Q_WORKFLOW_STEP,
] as const;

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
  /** Regenerate-a-summary extras (user directive, 2026-08-23): a template
      key from SUMMARY_TEMPLATES and/or the requester's own instruction.
      Only the summarize step reads them; absent on every other message. */
  template?: string;
  instruction?: string;
  /** Append the «ارقام و تاریخ‌ها» ledger section to the summary. */
  figures?: boolean;
  /** M39 backfill (2026-08-28): a fresh enrollment re-tries matching on
      recent records. Only link_speakers reads it, and with it set the step
      does NOTHING but match — no status move, no summarize, no events:
      re-firing those on an old call would re-summarize it and wake every
      call.transcribed subscriber for something that did not happen. */
  rematch?: boolean;
  /** 0094: the display name the produced version stores (a ruled key or a
      custom template's own name) — provenance, never a prompt. */
  label?: string;
}


/**
 * M35: a signal firing. `event` names WHY (the signal), the owner names WHO
 * the run executes as — written at enqueue time exactly like a pipeline
 * job's owner. `call.processed` carries its call; `cron.weekly` carries its
 * rule (stamped fired at enqueue, so a crash between enqueue and handling
 * costs one digest, never duplicates one).
 */
export interface SignalPayload {
  event: "call.processed" | "cron.weekly";
  ownerId: string;
  orgId: string;
  callId?: string;
  ruleId?: string;
}

/**
 * M41: the executor's program counter. The message is TRANSPORT (M7): the
 * handler re-reads the run row as the owner and refuses on any mismatch —
 * a forged payload buys an attacker a dead letter, never a read.
 */
export interface WorkflowStepPayload {
  runId: string;
  stepId: string;
  iteration: number;
  /** written at enqueue time, while a genuine caller was present (M7). */
  ownerId: string;
  orgId: string;
}

export type QueuePayload = JobPayload | SignalPayload | WorkflowStepPayload;

export function isSignalPayload(body: QueuePayload): body is SignalPayload {
  return typeof (body as SignalPayload).event === "string";
}

export function isWorkflowStepPayload(body: QueuePayload): body is WorkflowStepPayload {
  return typeof (body as WorkflowStepPayload).runId === "string"
    && typeof (body as WorkflowStepPayload).stepId === "string";
}

export interface QueueMessage<T = QueuePayload> {
  msgId: number;
  /** pgmq's delivery count — the attempt number, with no state of our own. */
  readCt: number;
  body: T;
}

export interface Queue {
  send(queue: QueueName, body: QueuePayload, delaySec?: number): Promise<number>;
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
  message: QueuePayload | string;
}

function parsePayload(message: QueuePayload | string): QueuePayload {
  return typeof message === "string" ? (JSON.parse(message) as QueuePayload) : message;
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
