import type { ReactNode, Ref, UIEvent } from "react";

/**
 * **A section's body scrolls; the frame around it does not.**
 *
 * User directive, 2026-08-29: *"for transcription page and summary page they
 * have to have their own scroll and not make the page scroll mode."* The
 * record page had the transcript capped by a hand-written
 * `max-h-[calc(100dvh-13rem)]` and the summary capped by nothing at all, so a
 * long summary grew the page and carried the title, the player and the
 * section's own header off the top of the screen while the reader scrolled.
 *
 * This is the ONE mechanism for that, for every surface: a box that ends
 * where the viewport does (`max-h-section`, derived from
 * `SCAFFOLD.page.sectionReserve`) and scrolls its own overflow. A screen
 * renders `<SectionScroller>` around a section's body — it never writes a
 * height, because a second height literal is the fork this component exists
 * to prevent (M45's five copies of the page column, in miniature).
 *
 * It is NOT a page scroller and must never become one: the shell owns the
 * page scroll (MenuLayout's content column), and an inner box scrolling its
 * own overflow is a different thing — see `scaffold.test.tsx`'s note on why
 * no repo-wide grep separates the two.
 *
 * `data-section-scroll` is part of the contract, not decoration: it is how a
 * test can ask "is the section's body inside its scroller, and its header
 * outside?" without counting style classes — and it is what `@media print`
 * in globals.css lifts the cap through, because a box that ends at the
 * viewport would print its first screenful and silently drop the rest.
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
      className={`scroll-quiet max-h-section overflow-y-auto ${className}`}
    >
      {children}
    </div>
  );
}
