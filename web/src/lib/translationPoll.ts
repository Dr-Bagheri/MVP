/**
 * Waiting for a translation the transcriber is preparing (2026-09-06, C4).
 * The request answers `queued` at once; the rows land minutes later. This
 * reads until the status settles — `ready` or `failed` — and gives up after
 * `maxMs` with its own error, so a screen never spins on a job nobody will
 * finish. Pure over an injected reader and sleeper, so the wait is a test
 * with fake time rather than a hope with real time.
 */
export interface Settleable {
  status: string;
}

export class TranslationTimeout extends Error {
  constructor() {
    super("translation did not settle in time");
    this.name = "TranslationTimeout";
  }
}

export async function pollUntilSettled<T extends Settleable>(
  read: () => Promise<T>,
  options: {
    intervalMs: number;
    maxMs: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const started = now();
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const current = await read();
    if (current.status === "ready" || current.status === "failed") return current;
    if (now() - started >= options.maxMs) throw new TranslationTimeout();
    await sleep(options.intervalMs);
  }
}
