/**
 * THE PERSON MARK — the round well that stands beside a name.
 *
 * Measured 2026-09-03: fifteen components drew this by hand, and in three
 * files alone there were four sizes (20, 28, 36, 48), three grounds
 * (`bg-accent-soft`, `bg-surface-2`, `bg-accent`), two ink colours, one ring
 * and no ring, and an initial that was uppercased in one place and not in the
 * others. It is the single element that appears beside every person's name in
 * the product, which makes it the one most likely to be seen twice on one
 * screen looking like two different things.
 *
 * The look here is the ROSTER's — `bg-accent-soft`, the page's own ink, a
 * hairline ring — because that is the one drawn during the reference-adoption
 * round with the reference open, and because a filled accent circle reads as
 * SELECTED rather than as a person.
 *
 * WHY IT IS A COMPONENT AND NOT A CLASS. `.btn` can be a class because a
 * button's contents are whatever you put in it. An avatar has behaviour: it
 * takes a person and decides what to show — a photo when there is one, the
 * first letter when there is not — and that decision was being re-made at
 * fifteen call sites, with `.slice(0, 1)` in some and `.charAt(0)` in others.
 * A shared class would have unified the circle and left the decision copied.
 *
 * NOT `.toUpperCase()` BLINDLY, and this is the Persian-first part: Persian
 * has no case, so uppercasing is a no-op there and the call is harmless — but
 * it is the LATIN half of a bilingual product where a lowercase initial beside
 * an uppercase one looks like a rendering fault, so it is applied once, here,
 * instead of being remembered at each site.
 */

const SIZE = {
  /** inside a chip — an assignee pill, a compact row */
  xs: { box: "h-5 w-5", text: "text-[10px]" },
  /** a list row, a menu row */
  sm: { box: "h-7 w-7", text: "text-[11px]" },
  /** the roster's, and the default */
  md: { box: "h-9 w-9", text: "text-xs" },
  /** a detail header */
  lg: { box: "h-12 w-12", text: "text-base" },
} as const;

export function Avatar({
  name,
  src,
  size = "md",
  className = "",
}: {
  /** the resolved display name — the caller owns which of the two names to
      use, because that is a locale decision (personName) and not this
      component's */
  name: string;
  /** a photo when the person has one */
  src?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const { box, text } = SIZE[size];
  /* `Array.from` rather than `name[0]`: a surrogate pair (an emoji, some
     scripts) is TWO code units, and slicing one of them renders the
     replacement character — a mark that is the same for every such person */
  const initial = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  const shell = `grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-border-strong ${box} ${className}`;

  if (src) {
    return (
      <span className={shell} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- an avatar is a
            data: URL or a signed URL, not a build-time asset for next/image */}
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      /* aria-hidden because the NAME is always beside it: a screen reader that
         reads the initial and then the name says the first letter twice */
      aria-hidden
      className={`${shell} bg-accent-soft font-semibold text-fg ${text}`}
    >
      {initial}
    </span>
  );
}
