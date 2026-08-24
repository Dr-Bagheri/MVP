/**
 * The executor: claim a message, run its step, and decide what the outcome
 * means for the message.
 *
 * Three outcomes and no others (M7): done, retry with backoff, or dead-letter.
 * The decision is a pure function of the error and the delivery count so it can
 * be tested exhaustively — this is the logic that decides whether a customer's
 * recording is retried or abandoned, and it should not be reasoned about by
 * reading an async loop.
 */
import { OwnerMismatchError, UnknownActorError } from "../db/actor.ts";
import { MlRequestError } from "./ml-client.ts";
import { backoffSeconds, type WorkerConfig } from "./config.ts";
import type { Queue, QueueMessage, QueueName, QueuePayload } from "./queue.ts";

/** A step's own failure, when it is not an ml/ failure. */
export class StepError extends Error {
  // Explicit fields, not constructor parameter properties — see the note in
  // ml-client.ts: `--experimental-strip-types` cannot transform them, so the
  // worker process fails to start while every test still passes.
  readonly errorType: string;
  readonly retryable: boolean;

  constructor(errorType: string, message: string, retryable: boolean) {
    super(message);
    this.name = "StepError";
    this.errorType = errorType;
    this.retryable = retryable;
  }
}

export type Disposition =
  | {
      action: "retry";
      delaySec: number;
      errorType: string;
      retryable: true;
      pg?: Failure["pg"];
    }
  | {
      action: "dead_letter";
      errorType: string;
      reason: string;
      exhausted: boolean;
      pg?: Failure["pg"];
    };

export interface Failure {
  errorType: string;
  retryable: boolean;
  message: string;
  /**
   * Postgres's STRUCTURED error fields, when the failure came from the
   * database. These name the constraint, table and column — they never carry
   * row values, unlike the message text, which for a unique violation happily
   * quotes the offending data and would put transcript content in a log
   * (Invariant 7). This is what makes a database failure diagnosable without
   * making it a leak.
   */
  pg?: { code?: string; constraint?: string; table?: string; column?: string };
}

interface PgErrorish {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  table_name?: string;
  table?: string;
  column_name?: string;
  column?: string;
}

function pgFields(error: unknown): Failure["pg"] {
  if (!error || typeof error !== "object") return undefined;
  const e = error as PgErrorish;
  if (!e.code) return undefined;
  const constraint = e.constraint_name ?? e.constraint;
  const table = e.table_name ?? e.table;
  const column = e.column_name ?? e.column;
  return {
    code: e.code,
    ...(constraint ? { constraint } : {}),
    ...(table ? { table } : {}),
    ...(column ? { column } : {}),
  };
}

/**
 * Normalize anything thrown into the two facts that matter.
 *
 * An UNRECOGNISED error is treated as retryable on purpose. The alternative —
 * dead-lettering on a surprise — abandons a customer's recording because of a
 * bug on our side; retrying at worst wastes attempts and then dead-letters
 * anyway, with the attempt count as evidence.
 */
export function classify(error: unknown): Failure {
  if (error instanceof MlRequestError) {
    return { errorType: error.errorType, retryable: error.retryable, message: error.message };
  }
  if (error instanceof StepError) {
    return { errorType: error.errorType, retryable: error.retryable, message: error.message };
  }

  // Identity failures are RECOGNISED conditions, not surprises, so they get
  // named rather than dead-lettering as "unexpected" after five attempts and
  // half an hour of backoff. The retryability differs because the causes do:
  //
  //  - the owner's row does not exist       → nothing will change that on its
  //                                           own; fail now and say why.
  //  - the owner cannot see their own call  → could be a pending/disabled
  //                                           member or a suspended org, which
  //                                           an admin may reinstate; could
  //                                           equally be a stale or forged
  //                                           payload. Retrying costs little
  //                                           and the attempt count is the
  //                                           evidence either way.
  //
  // (Since core/'s resolveIdentity moved to a LEFT JOIN, an inactive owner
  // resolves with isActive:false and then fails the fail-closed re-read —
  // arriving here as OwnerMismatchError rather than UnknownActorError.)
  if (error instanceof UnknownActorError) {
    return { errorType: "owner_not_found", retryable: false, message: error.message };
  }
  if (error instanceof OwnerMismatchError) {
    return { errorType: "owner_cannot_see_call", retryable: true, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const pg = pgFields(error);
  return { errorType: "unexpected", retryable: true, message, ...(pg ? { pg } : {}) };
}

/**
 * What to do with the message. `attempt` is pgmq's `read_ct`: the number of
 * times this message has been delivered, including now.
 */
export function disposition(error: unknown, attempt: number, config: WorkerConfig): Disposition {
  const failure = classify(error);

  if (!failure.retryable) {
    // Repeating this changes nothing — a file that is not audio will not
    // become audio. Fail it now rather than burning four more attempts and
    // making the customer wait for the same answer.
    return {
      action: "dead_letter",
      errorType: failure.errorType,
      reason: failure.message,
      exhausted: false,
      ...(failure.pg ? { pg: failure.pg } : {}),
    };
  }

  if (attempt >= config.maxAttempts) {
    return {
      action: "dead_letter",
      errorType: failure.errorType,
      reason: `${failure.message} (gave up after ${attempt} attempts)`,
      exhausted: true,
      ...(failure.pg ? { pg: failure.pg } : {}),
    };
  }

  return {
    action: "retry",
    delaySec: backoffSeconds(attempt, config),
    errorType: failure.errorType,
    retryable: true,
    ...(failure.pg ? { pg: failure.pg } : {}),
  };
}

/**
 * DEV ONLY, and off unless `WORKER_DEBUG_ERRORS=1`.
 *
 * Error message text is deliberately NOT logged in normal operation: a
 * constraint violation quotes the offending row, which here can be transcript
 * content (Invariant 7). The structured `pg` fields exist so diagnosis does
 * not need this. But some failures — a bare `42501` with no table attached —
 * name nothing at all, and then a developer needs the sentence.
 */
function debugMessage(error: unknown): { debug_message?: string } {
  if (process.env.WORKER_DEBUG_ERRORS !== "1") return {};
  const message = error instanceof Error ? error.message : String(error);
  return { debug_message: message.slice(0, 500) };
}

export interface StepLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface StepHandler {
  readonly name: string;
  readonly queue: QueueName;
  handle(payload: QueuePayload, context: { attempt: number; log: StepLogger }): Promise<void>;
}

/**
 * What a dead letter MEANS is a product decision, not a queue one, so it is
 * injected: a part that can never be recovered becomes a visible gap in the
 * call rather than the loss of the whole recording (M7, and the Echo Mobile
 * lesson behind it), while a per-call step failing does fail the call.
 */
export interface DeadLetterSink {
  onDeadLetter(
    queue: QueueName,
    payload: QueuePayload,
    info: { errorType: string; reason: string; exhausted: boolean },
  ): Promise<void>;
}

export interface RunnerOptions {
  queue: Queue;
  handlers: StepHandler[];
  config: WorkerConfig;
  sink: DeadLetterSink;
  log: StepLogger;
}

export interface PollResult {
  claimed: number;
  done: number;
  retried: number;
  deadLettered: number;
}

export function createRunner({ queue, handlers, config, sink, log }: RunnerOptions) {
  const byQueue = new Map<QueueName, StepHandler>();
  for (const handler of handlers) {
    if (byQueue.has(handler.queue)) {
      throw new Error(`two handlers claim queue ${handler.queue}`);
    }
    byQueue.set(handler.queue, handler);
  }

  async function processOne(
    handler: StepHandler,
    message: QueueMessage,
    result: PollResult,
  ): Promise<void> {
    const base = { step: handler.name, msg_id: message.msgId, attempt: message.readCt };
    try {
      await handler.handle(message.body, { attempt: message.readCt, log });
      await queue.remove(handler.queue, message.msgId);
      result.done++;
      log.info(base, "step done");
      return;
    } catch (error) {
      const decision = disposition(error, message.readCt, config);

      if (decision.action === "retry") {
        await queue.delay(handler.queue, message.msgId, decision.delaySec);
        result.retried++;
        log.warn(
          {
            ...base,
            error_type: decision.errorType,
            retry_in_sec: decision.delaySec,
            ...(decision.pg ? { pg: decision.pg } : {}),
            ...debugMessage(error),
          },
          "step failed; retrying",
        );
        return;
      }

      // Dead-letter. Archive FIRST: if marking the row fails, we must not
      // leave the message live to be redelivered forever. An archived message
      // is recoverable by hand; an infinite redelivery loop is not.
      await queue.archive(handler.queue, message.msgId);
      result.deadLettered++;
      log.error(
        { ...base, error_type: decision.errorType, exhausted: decision.exhausted },
        "step dead-lettered",
      );
      await sink.onDeadLetter(handler.queue, message.body, {
        errorType: decision.errorType,
        reason: decision.reason,
        exhausted: decision.exhausted,
      });
    }
  }

  return {
    /** One pass over every queue. Returns what happened, for the caller's loop. */
    async poll(): Promise<PollResult> {
      const result: PollResult = { claimed: 0, done: 0, retried: 0, deadLettered: 0 };

      for (const handler of handlers) {
        const messages = await queue.read(
          handler.queue,
          config.visibilityTimeoutSec,
          config.batchSize,
        );
        result.claimed += messages.length;

        /*
         * Bounded concurrency within a queue (speed pass, 2026-08-23).
         * `config.concurrency` used to size the connection pool and gate
         * NOTHING — the loop ran strictly one message at a time, so a
         * three-part call transcribed serially while the knob read as 2.
         * Parts are independent by construction (deterministic seq ranges,
         * per-part artifacts, idempotent duration recompute), so running
         * up to `concurrency` messages of one queue together is safe; a
         * duplicate delivery still trips the UNIQUE walls loudly.
         */
        const inFlight: Promise<void>[] = [];
        for (const message of messages) {
          const one = processOne(handler, message, result).finally(() => {
            inFlight.splice(inFlight.indexOf(one), 1);
          });
          inFlight.push(one);
          if (inFlight.length >= Math.max(1, config.concurrency)) {
            await Promise.race(inFlight);
          }
        }
        await Promise.all(inFlight);
      }

      return result;
    },
  };
}
