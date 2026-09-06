/**
 * THE RELAY GATE — how often the voice loop may open a live-transcription
 * session when the last one did not go well. Pure, so the decision is
 * testable without a microphone.
 *
 * THE INCIDENT IT EXISTS FOR (production, 2026-09-05 22:00 → 09-06 08:00
 * UTC): the provider socket behind the relay failed on every session — a
 * handshake that never completed, each session dead within ~20 ms — and the
 * loop, which opens a session on every voiced frame and had no memory of the
 * last one, reopened one every 400 ms for ten hours: 120,000 starts, 670,000
 * audio posts, 77,000 "write after end" errors in the api log, and captions
 * that were down the entire time with nothing on screen saying so. Nobody
 * was talking; a room's noise floor above the speech threshold was enough.
 *
 * The rule is the ordinary circuit breaker, spelled for this loop:
 *
 * - a session the SERVER ended (a `closed`/`error` frame, or a start that
 *   failed) after less than `shortMs` and without a single token is a SHORT
 *   END; each consecutive short end doubles the wait before the next open,
 *   from `baseDelayMs` up to `maxDelayMs`;
 * - a session we ended ourselves (silence, mute, stop), one that lived past
 *   `shortMs`, or one that produced tokens is a GOOD session and clears the
 *   count — a person who talks and is heard is never throttled;
 * - `tripAfter` consecutive short ends TRIP the breaker: no opens for
 *   `tripPauseMs`, and the caller is told ONCE (the ears say they are
 *   resting), so the silence has a sentence; after the pause the loop tries
 *   again on its own, and a working relay clears everything.
 *
 * It is a gate, not a clock: nothing in here schedules anything. The loop
 * asks `canOpen(now)` at every onset, which is where the decision belongs.
 */
export interface RelayGateOptions {
  /** a server-ended session shorter than this, with no tokens, is a short end */
  shortMs?: number;
  /** the first wait after a short end; doubles per consecutive short end */
  baseDelayMs?: number;
  /** the wait never grows past this */
  maxDelayMs?: number;
  /** consecutive short ends that trip the breaker */
  tripAfter?: number;
  /** how long a tripped breaker keeps the relay shut */
  tripPauseMs?: number;
}

export type RelayEndVerdict = "ok" | "backoff" | "tripped";

export interface RelayGate {
  /** may a session be opened at `now`? */
  canOpen(now: number): boolean;
  /** a session opened at `now` */
  noteOpened(now: number): void;
  /** the open session produced transcription — it is a real session however short */
  noteTokens(): void;
  /**
   * the session ended at `now`. `byServer` = the relay sent `closed`/`error`,
   * or the start itself failed; false = we closed it (silence, mute, stop).
   * Returns "tripped" exactly once per trip, so the caller can say so once.
   */
  noteEnded(now: number, byServer: boolean): RelayEndVerdict;
  /** consecutive short ends so far (0 after any good session) */
  readonly shortEnds: number;
  /** the moment the next open is allowed (0 = now) */
  readonly notBefore: number;
}

export function createRelayGate(options: RelayGateOptions = {}): RelayGate {
  const shortMs = options.shortMs ?? 5_000;
  const baseDelayMs = options.baseDelayMs ?? 1_500;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const tripAfter = options.tripAfter ?? 6;
  const tripPauseMs = options.tripPauseMs ?? 5 * 60_000;

  let notBefore = 0;
  let shortEnds = 0;
  let openedAt: number | null = null;
  let sawTokens = false;
  let announced = false;

  return {
    canOpen: (now) => now >= notBefore,
    noteOpened: (now) => {
      openedAt = now;
      sawTokens = false;
    },
    noteTokens: () => {
      sawTokens = true;
    },
    noteEnded: (now, byServer) => {
      const lived = openedAt === null ? 0 : Math.max(0, now - openedAt);
      openedAt = null;
      const good = !byServer || sawTokens || lived >= shortMs;
      sawTokens = false;
      if (good) {
        shortEnds = 0;
        notBefore = 0;
        announced = false;
        return "ok";
      }
      shortEnds += 1;
      if (shortEnds >= tripAfter) {
        notBefore = now + tripPauseMs;
        if (announced) return "backoff";
        announced = true;
        return "tripped";
      }
      notBefore = now + Math.min(maxDelayMs, baseDelayMs * 2 ** (shortEnds - 1));
      return "backoff";
    },
    get shortEnds() { return shortEnds; },
    get notBefore() { return notBefore; },
  };
}
