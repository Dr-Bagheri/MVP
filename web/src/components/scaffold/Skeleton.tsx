/**
 * THE PLATFORM'S LOADING RULE, as a component.
 *
 * User directive, 2026-09-02: "even if it's loading the icon must be there and
 * the information in it must be loading … make a solid section for them and
 * just the information should load in it, not the way it is now that it does
 * not show the section until it loads the information for it. Add this as a
 * rule in whole platform too."
 *
 * The shape that was wrong is `data === null ? null : <section>…</section>`.
 * It reads as careful — nothing renders until there is something true to show
 * — and what it produces is a page that assembles itself in front of the
 * reader: a title appears, then a gap, then a table drops in and pushes
 * everything below it down. Every section arriving on its own schedule looks
 * like a different product each second it is open.
 *
 * The rule instead: THE FRAME IS STRUCTURE AND STRUCTURE IS KNOWN. A heading,
 * a card, a table's header row, the bell in the top bar — none of that depends
 * on the network, so none of it waits for the network. What waits is the
 * CONTENT, and while it waits it occupies the space it is about to fill.
 *
 * Two consequences worth stating, because both are the point:
 *   - the layout does not move when the data lands, so nothing is pressed by
 *     accident and nothing is read half-way and then shifted away;
 *   - "loading" and "empty" stop looking identical. A section that renders
 *     nothing while loading is indistinguishable from a section with no rows,
 *     which is the kinds-of-nothing confusion in visual form.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      /* `animate-pulse` on a token background, not a grey literal: a skeleton
         is part of the surface it stands in and has to be right in both
         themes, like everything else here */
      className={`block animate-pulse rounded-md bg-surface-2 ${className}`}
    />
  );
}

/**
 * A block of skeleton lines — the default filler for a section whose content
 * is prose or a short list.
 *
 * `lines` should match what is coming: the space reserved is a promise about
 * the size of the thing, and a promise that is wrong moves the layout anyway.
 */
export function SkeletonLines({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          /* the last line short, the way real text ends — a stack of
             identical full-width bars reads as a rendering fault */
          className={`h-4 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/**
 * A grid of placeholder CARDS — the loading state for a surface whose content
 * is tiles rather than rows (agents, workflows, integrations).
 *
 * Same rule as the table's skeleton rows and for the same reason: the grid
 * itself is structure, so it renders with the page, and only the cards inside
 * it wait. A grid that appears whole after the network makes everything below
 * it jump, and a grid that renders nothing while loading is indistinguishable
 * from a grid with nothing in it.
 */
export function SkeletonCards({
  count = 4,
  className = "grid gap-5 lg:grid-cols-2",
  height = "h-40",
}: {
  count?: number;
  className?: string;
  /** match the real card — reserved space that is the wrong size still moves
      the layout, which is the thing this exists to prevent */
  height?: string;
}) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`rounded-2xl border border-border bg-surface p-7 ${height}`}>
          <Skeleton className="h-11 w-11 rounded-xl" />
          <Skeleton className="mt-6 h-4 w-40" />
          <Skeleton className="mt-2.5 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
