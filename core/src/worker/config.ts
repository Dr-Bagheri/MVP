/**
 * Worker configuration — env only.
 *
 * **Concurrency ships as knobs, not as inherited numbers.** The Phase-0 spike
 * measured diarization at 0.33× realtime on an idle box and 1.97× on the same
 * file with the machine loaded — a 6× swing from contention alone. Any default
 * here is a guess about a machine nobody has met yet, so the defaults are
 * deliberately conservative and the real values come from measuring on the
 * deployment box. Do not raise these because a spike run looked fast.
 */

function int(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return dflt;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`worker: ${name} must be a positive number`);
  }
  return Math.floor(value);
}

function str(name: string, dflt: string): string {
  return process.env[name] || dflt;
}

export interface WorkerConfig {
  mlBaseUrl: string;
  mlTimeoutMs: number;

  /** Messages claimed per poll, per queue. */
  batchSize: number;
  /** Jobs executed at once across all queues. The CPU-bound ceiling. */
  concurrency: number;
  /** How long a claimed message stays invisible. Must exceed the step's runtime. */
  visibilityTimeoutSec: number;
  /** Idle sleep between polls when every queue was empty. */
  idlePollMs: number;

  /** Deliveries before a message is dead-lettered. pgmq's read_ct is the counter. */
  /** Ceiling for the idle backoff. Set equal to `idlePollMs` to disable it. */
  idleMaxPollMs: number;
  /** Consecutive empty polls before the interval starts growing. */
  idleBackoffAfter: number;
  maxAttempts: number;
  retryBaseSec: number;
  retryMaxSec: number;
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    mlBaseUrl: str("ML_BASE_URL", "http://127.0.0.1:7801"),
    // A 30-minute part legitimately takes minutes end to end.
    mlTimeoutMs: int("WORKER_ML_TIMEOUT_MS", 20 * 60 * 1000),

    batchSize: int("WORKER_BATCH_SIZE", 5),
    // One at a time by default. Transcription is network-bound and diarization
    // is the heaviest CPU stage in the product; raising this without measuring
    // turns a fast box into a slow one, as the spike's 4-threads-beat-8 result
    // already demonstrated one level down.
    concurrency: int("WORKER_CONCURRENCY", 2),
    // Longer than the slowest expected step, or the queue hands the same work
    // to a second worker while the first is still doing it.
    visibilityTimeoutSec: int("WORKER_VISIBILITY_TIMEOUT_SEC", 30 * 60),
    idlePollMs: int("WORKER_IDLE_POLL_MS", 2000),
    // See `idleBackoffMs` below for the curve and the trade it makes.
    idleMaxPollMs: int("WORKER_IDLE_MAX_POLL_MS", 6000),
    idleBackoffAfter: int("WORKER_IDLE_BACKOFF_AFTER", 30),

    maxAttempts: int("WORKER_MAX_ATTEMPTS", 5),
    retryBaseSec: int("WORKER_RETRY_BASE_SEC", 10),
    retryMaxSec: int("WORKER_RETRY_MAX_SEC", 15 * 60),
  };
}

/**
 * How long to sleep after `emptyPolls` consecutive polls that found nothing.
 *
 * ── the trade, stated ───────────────────────────────────────────────────────
 *
 * A flat two-second poll costs the same whether the product is busy or asleep.
 * Backing off saves those round trips and buys them with LATENCY on the first
 * message after a quiet stretch — and latency is user-visible where the round
 * trips are not, so the curve is deliberately gentle rather than aggressive.
 *
 *   polls 1-30   (0-60 s of silence)   2.0 s   — unchanged from before
 *   poll  31                           3.0 s
 *   poll  32                           4.5 s
 *   poll  33+                          6.0 s   (ceiling)
 *
 * Worst case a message waits 6 s instead of 2 s, and ONLY as the first message
 * after a full minute of silence: any non-empty poll resets the counter, so a
 * burst runs at full speed from its second message onward.
 *
 * This does NOT meet the "no more than a second or two" bar that was asked
 * for, and it cannot: any backoff whose ceiling is two seconds is not a
 * backoff. Recorded rather than fudged — and the bar is still reachable,
 * because it does not depend on this function. Collapsing the five per-handler
 * reads into one statement already cut the idle cost by about 80% at ZERO
 * latency, so an operator who wants the strict latency can set
 * WORKER_IDLE_MAX_POLL_MS=2000, disable the curve entirely, and keep that.
 *
 * The three queues the worker fills itself — link_speakers, summarize,
 * workflow_step — are enqueued by a worker that is by definition not idle, so
 * the counter has already reset and they are never delayed by this at all. The
 * only message this can hold up is one from the api after a genuinely quiet
 * minute, ahead of a transcription measured in minutes.
 */
export function idleBackoffMs(emptyPolls: number, config: WorkerConfig): number {
  const over = emptyPolls - config.idleBackoffAfter;
  if (over <= 0) return config.idlePollMs;
  const grown = config.idlePollMs * 1.5 ** over;
  return Math.min(Math.round(grown), config.idleMaxPollMs);
}

/**
 * Exponential backoff on the delivery count, capped. pgmq's `read_ct` is the
 * attempt number, so this needs no state of its own — a restarted worker
 * resumes the same schedule instead of starting the backoff over.
 */
export function backoffSeconds(attempt: number, config: WorkerConfig): number {
  const exponent = Math.max(0, attempt - 1);
  const seconds = config.retryBaseSec * 2 ** exponent;
  return Math.min(seconds, config.retryMaxSec);
}
