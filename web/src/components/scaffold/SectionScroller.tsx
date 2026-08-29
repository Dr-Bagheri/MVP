import type { ReactNode, Ref, UIEvent } from "react";

/**
 * THE one box that scrolls a section's body.
 *
 * It takes the space its section has left (`flex-1 min-h-0`) — it does not
 * COMPUTE a ceiling. The first cut did: a `max-h` of the viewport minus a
 * reserve in rem, the reserve being a guess about how tall the title, the
 * player and the section header add up to. On the window it was measured
 * on the guess fit; on a shorter one it did not, the card outgrew the
 * shell's column, and the whole page went back to scrolling — the bug it
 * was written to fix, hiding behind a number that was nearly right.
 *
 * Layout cannot be nearly right: the page fills the column the shell
 * bounds (`PageContainer fill`), the section is a column whose header is
 * fixed, and whatever is left is this box. No arithmetic to keep in sync
 * with the chrome above it, and nothing to re-tune when a control moves.
 *
 * `data-section-scroll` marks it for the print rule in globals.css: a
 * capped box prints its first screenful and silently drops the rest, so
 * printing lifts the cap.
 */
export function SectionScroller({
  children,
  scrollRef,
  onScroll,
  onMouseUp,
  className = "",
}: {
  children: ReactNode;
  /**
   * The scrolling element itself — the record's transcript keeps the playing
   * line in view and restores a scroll position through it, so the ref has
   * to reach the box that actually scrolls, not a wrapper around it.
   */
  scrollRef?: Ref<HTMLDivElement>;
  /** progressive lists load their next slab from here */
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  /** selection-driven affordances (the transcript's «save as note») */
  onMouseUp?: () => void;
  className?: string;
}) {
  return (
    <div
      ref={scrollRef}
      data-section-scroll=""
      onScroll={onScroll}
      onMouseUp={onMouseUp}
      /* scroll-quiet: the theme's thin scrollbar, so an inner scroller looks
         like the shell's one rather than growing a second, heavier bar */
      className={`scroll-quiet min-h-0 flex-1 overflow-y-auto ${className}`}
    >
      {children}
    </div>
  );
}
