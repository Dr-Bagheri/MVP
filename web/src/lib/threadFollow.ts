/**
 * The conversation thread's auto-follow DECISION, kept pure.
 *
 * jsdom lays nothing out, so a component test can never hold the real
 * scrolling behaviour — but it can hold the decision, which is where the
 * bug that matters lives. The rule (the Sana shape, user directive
 * 2026-08-28):
 *
 * - While the reader is at (or near) the bottom, the thread FOLLOWS: every
 *   new message or streaming delta keeps the latest words in view.
 * - When the reader has scrolled UP to re-read something older, the answer
 *   is NO. Re-scrolling them down mid-read is fighting, not following —
 *   the difference between a thread that keeps you company and one that
 *   snatches the page out of your hands. They re-pin by returning to the
 *   bottom themselves.
 *
 * The threshold exists because streaming grows the thread in small steps:
 * the instant a delta lands, the reader who WAS at the bottom is now a few
 * pixels above it. Exact equality would unpin on the first delta and the
 * thread would follow nothing. 48px is comfortably larger than any single
 * delta's growth and comfortably smaller than a deliberate scroll-up.
 *
 * A container that cannot scroll (content shorter than the box, or a
 * viewport where the box does not scroll at all) reports distance 0 and
 * stays pinned — the only honest answer when there is nowhere to be but
 * the bottom.
 */
export const FOLLOW_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Should the thread stay pinned to its bottom, given where the reader is? */
export function shouldStick(
  metrics: ScrollMetrics,
  thresholdPx: number = FOLLOW_THRESHOLD_PX,
): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distanceFromBottom <= thresholdPx;
}
