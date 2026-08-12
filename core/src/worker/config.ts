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

    maxAttempts: int("WORKER_MAX_ATTEMPTS", 5),
    retryBaseSec: int("WORKER_RETRY_BASE_SEC", 10),
    retryMaxSec: int("WORKER_RETRY_MAX_SEC", 15 * 60),
  };
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
