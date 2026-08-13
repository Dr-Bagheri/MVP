/**
 * The platform's navigation model — ONE list, consumed by both the icon rail
 * (md and up) and the mobile bottom bar.
 *
 * Two renderings of one nav is exactly the shape that drifts: a destination
 * added to the rail and forgotten in the bar is invisible until someone opens
 * the app on a phone. So the destinations live here, each declaring whether it
 * belongs in the bar, and each surface maps over the same array.
 */

export interface NavItem {
  href: string;
  /** Key under the `platform` message namespace. */
  key: string;
  /** Also rendered in the mobile bottom bar. */
  inBar: boolean;
}

/**
 * GitHub's target is an open user question (which repo — and a private repo's
 * link 404s for a customer). It ships pointing at a named constant so the entry
 * exists and the answer has exactly one place to land. A plausible-looking URL
 * would be worse than an obvious placeholder.
 */
export const GITHUB_HREF = process.env.NEXT_PUBLIC_GITHUB_URL ?? "#";

/** Primary destinations — the top of the rail. */
export const NAV_PRIMARY: readonly NavItem[] = [
  { href: "/", key: "hub", inBar: true },
  { href: "/echo", key: "echo", inBar: true },
  { href: "/management", key: "management", inBar: true },
];

/**
 * The rail's bottom group: low-frequency destinations. They do not earn
 * permanent slots on a phone and live behind "More" there instead.
 */
export const NAV_UTILITY: readonly NavItem[] = [
  { href: "/settings", key: "settings", inBar: false },
  { href: "/help", key: "help", inBar: false },
  { href: GITHUB_HREF, key: "github", inBar: false },
];

/** Bottom-bar items = the flagged primaries; "More" occupies the last slot. */
export const NAV_BAR: readonly NavItem[] = NAV_PRIMARY.filter((i) => i.inBar);

/**
 * M22's bottom bar is FOUR items — Hub · Echo · Management · More. Three
 * primaries plus More, which leaves a slot for the second app and keeps the
 * ≤5 ceiling the proposal argued for.
 *
 * The ceiling is asserted in `nav.test.ts`, NOT here. The first draft of this
 * file tried a type-level count and it could never have worked: `.filter()`
 * widens `length` to `number`, so the assertion would have been either
 * vacuously true or permanently false regardless of how many items existed —
 * a check that cannot fail for the reason it was written is worse than none.
 * A test runs, and it fails with a number in the message.
 */
export const BAR_CEILING = 4;
