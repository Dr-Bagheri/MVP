import { useCallback, useEffect, useRef } from "react";

/**
 * The conversation thread's auto-follow — the DECISION (pure) and the
 * MECHANISM (a hook), in one place, for every surface that shows a thread.
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

/**
 * ── THE MECHANISM (user report, 2026-09-06: "the messages from agents or
 * echo go under the field of vision … it must scroll itself, it's a bug") ──
 *
 * Four surfaces followed their thread by hand, and every copy had the same
 * hole: the follow ran when the MESSAGE LIST changed, and at no other time.
 * The consent card, the refusal line, the standing-yes line, a mail draft,
 * the floor chip pushing the composer up, the composer growing to its third
 * line — each changes what fits in the box without touching the list, so
 * each landed below the fold and stayed there until the reader went looking.
 * The sidebar's copy had the opposite fault as well: it had no decision at
 * all, so it dragged a reader who had scrolled up back down on every delta.
 *
 * So the follow is keyed on GEOMETRY, not on state. One ResizeObserver
 * watches the BOX (it shrinks when something above or below it grows) and
 * the ONE element that wraps everything inside it (it grows with every
 * delta, card, line and late-loading image). Both deliver after layout and
 * before paint, so a pinned reader never sees the frame in which the newest
 * line sits below the edge. The decision stays the reader's: their scroll
 * events set `pinned` through `shouldStick`, their own send re-pins, and
 * nothing else moves it.
 *
 * The consumer's part is exactly three attachments and one call — the box
 * gets `scrollerRef` + `onScroll`, its single content wrapper gets
 * `contentRef`, and the person's own acts (send, open a thread, start
 * fresh) call `repin()`. A card rendered OUTSIDE the wrapper is a card the
 * follow cannot see; the surface tests assert the card is inside it.
 *
 * `followPage` is the assistant page's mobile case: below md the shell is
 * unbounded, the box grows with its content and the PAGE scrolls, so the
 * end of the content is brought into view instead. Gated on the box having
 * no overflow of its own, so on md+ it never scrolls an ancestor; and the
 * pin is still read off the box there, which never scrolls — the mobile
 * layout follows unconditionally, exactly as it did before this hook.
 *
 * Without a ResizeObserver (jsdom) nothing follows by itself and `repin`
 * still writes; the tests install a fake and drive it.
 */
export interface ThreadFollow {
  /** the scrolling box — the element that carries `overflow-y-auto` */
  scrollerRef: (node: HTMLElement | null) => void;
  /** the ONE element wrapping everything that scrolls inside the box */
  contentRef: (node: HTMLElement | null) => void;
  /** the box's own scroll handler: the decision, recomputed on every scroll, theirs or ours */
  onScroll: (event: { currentTarget: ScrollMetrics }) => void;
  /** the reader acted at the composer (or opened a thread): pin and go to the bottom now */
  repin: () => void;
}

type Slot = { current: HTMLElement | null };

export function useThreadFollow(
  { followPage = false }: { followPage?: boolean } = {},
): ThreadFollow {
  const pinned = useRef(true);
  const box = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const page = useRef(followPage);
  page.current = followPage;

  const settle = useCallback(() => {
    const el = box.current;
    if (el === null) return;
    /* instant, never smooth: a smooth scroll issued on every streaming delta
       lags its own target and judders; pinning is a position, not an
       animation */
    el.scrollTop = el.scrollHeight;
    if (page.current && el.scrollHeight <= el.clientHeight) {
      content.current?.scrollIntoView({ block: "end" });
    }
  }, []);

  /* one observer for the hook's life, made on first need — so a box that
     unmounts and mounts again (the hub swaps a skeleton for the thread) is
     simply re-observed, and the first observation of a mounted box is itself
     a delivery, which is what puts a freshly opened thread at its bottom */
  const watch = useCallback((slot: Slot, node: HTMLElement | null) => {
    if (slot.current !== null) observer.current?.unobserve(slot.current);
    slot.current = node;
    if (node === null || typeof ResizeObserver === "undefined") return;
    if (observer.current === null) {
      observer.current = new ResizeObserver(() => {
        if (pinned.current) settle();
      });
    }
    observer.current.observe(node);
  }, [settle]);

  const scrollerRef = useCallback((node: HTMLElement | null) => { watch(box, node); }, [watch]);
  const contentRef = useCallback((node: HTMLElement | null) => { watch(content, node); }, [watch]);

  useEffect(() => () => {
    observer.current?.disconnect();
    observer.current = null;
  }, []);

  const onScroll = useCallback((event: { currentTarget: ScrollMetrics }) => {
    pinned.current = shouldStick(event.currentTarget);
  }, []);

  const repin = useCallback(() => {
    pinned.current = true;
    settle();
  }, [settle]);

  return { scrollerRef, contentRef, onScroll, repin };
}
