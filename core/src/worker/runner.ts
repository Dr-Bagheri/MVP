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
import { MlRequestError } from "./ml-client.ts";
import { backoffSeconds, type WorkerConfig } from "./config.ts";
import type { JobPayload, Queue, QueueMessage, QueueName } from "./queue.ts";

/** A step's own failure, when it is not an ml/ failure. */
export class StepError extends Error {
  constructor(
    readonly errorType: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StepError";
  }
}

export type Disposition =
  | { action: "retry"; delaySec: number; errorType: string; retryable: true }
  | { action: "dead_letter"; errorType: string; reason: string; exhausted: boolean };

export interface Failure {
  errorType: string;
  retryable: boolean;
  message: string;
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
  const message = error instanceof Error ? error.message : String(error);
  return { errorType: "unexpected", retryable: true, message };
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
    };
  }

  if (attempt >= config.maxAttempts) {
    return {
      action: "dead_letter",
      errorType: failure.errorType,
      reason: `${failure.message} (gave up after ${attempt} attempts)`,
      exhausted: true,
    };
  }

  return {
    action: "retry",
    delaySec: backoffSeconds(attempt, config),
    errorType: failure.errorType,
    retryable: true,
  };
}

export interface StepLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface StepHandler {
  readonly name: string;
  readonly queue: QueueName;
  handle(payload: JobPayload, context: { attempt: number; log: StepLogger }): Promise<void>;
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
    payload: JobPayload,
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
          { ...base, error_type: decision.errorType, retry_in_sec: decision.delaySec },
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

        // Sequential within a queue: these steps are CPU- and network-heavy,
        // and the concurrency ceiling is a knob rather than an accident of how
        // many messages happened to arrive together.
        for (const message of messages) {
          await processOne(handler, message, result);
        }
      }

      return result;
    },
  };
}
