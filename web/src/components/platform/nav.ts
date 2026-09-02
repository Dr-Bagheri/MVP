/**
 * The platform's navigation model — ONE list, consumed by both the icon rail
 * (md and up) and the mobile bottom bar.
 *
 * Two renderings of one nav is exactly the shape that drifts: a destination
 * added to the rail and forgotten in the bar is invisible until someone opens
 * the app on a phone. So the destinations live here, each declaring whether it
 * belongs in the bar, and each surface maps over the same array.
 */

import { SETTINGS_SECTIONS } from "./settingsSections";

export interface NavItem {
  href: string;
  /** Key under the `platform` message namespace. */
  key: string;
  /** Also rendered in the mobile bottom bar. */
  inBar: boolean;
}

/**
 * The GitHub entry points at the product's repo — ANSWERED by the user
 * (2026-08-16): github.com/Dr-Bagheri/MVP. PUBLIC since 2026-08-28 (user
 * directive, source-available license), so the link resolves for everyone;
 * the env var stays as the override seam.
 */
export const GITHUB_HREF = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/Dr-Bagheri/MVP";

/** Primary destinations — the top of the rail. */
/*
 * The rail is back to the three primaries (user directive, 2026-08-18,
 * second round): History, Search, Workflows, Prompts and Integrations lived here for a
 * morning and left the same day — they are the HUB's section menu now
 * (AssistantMenu), where the assistant's own destinations belong. The rail
 * names apps and surfaces; the sub-menu names what you do inside one.
 */
/*
 * 2026-08-25 (user directive): the DASHBOARD is the landing page and the
 * rail's first tile; the assistant moved off `/` to its own address and
 * its own icon (the house never named it well).
 *
 * The assistant is deliberately NOT in the mobile bar: the presence orb is
 * on every screen at every width, so a bar slot would be a second door to
 * the same room — and M22's four-item ceiling (asserted in nav.test.ts)
 * has no room to spare.
 */
export const NAV_PRIMARY: readonly NavItem[] = [
  /*
   * The dashboard is BACK (user directive, 2026-08-29: "now bring back the
   * dashboard as well"), and with it the pre-park arrangement: the board is
   * the landing page and the rail's first tile, the assistant keeps its own
   * address and its own tile.
   *
   * The assistant is out of the MOBILE BAR rather than out of the rail, and
   * for the reason it was out before: M22's four-item ceiling (asserted in
   * nav.test.ts) leaves three slots beside "More", and the presence orb is
   * a door to the assistant on every screen that is not already one of the
   * assistant's own.
   */
  /*
   * THE ORDER IS THE USER'S (2026-09-02): dashboard, meetings, tasks,
   * assistant — the day's work first and the assistant beside it, rather
   * than the assistant second because it used to own the landing page.
   */
  { href: "/", key: "dashboard", inBar: true },
  /* 0145 — meetings (the reference adoption). */
  { href: "/meetings", key: "meetings", inBar: false },
  /* 0144 — the task board (the reference adoption). Rail only: M22's
     four-item bar ceiling has no free slot, and tasks are a desk surface. */
  { href: "/tasks", key: "tasks", inBar: false },
  { href: "/assistant", key: "assistant", inBar: false },
  /*
   * Workflows, Integrations and Agents came OUT of the assistant's section
   * menu and onto the rail (user directive): they are surfaces of their own,
   * and a person looking for their integrations was opening the assistant to
   * find them. The rail names surfaces; that is what these are.
   */
  { href: "/workflows", key: "workflows", inBar: false },
  /* INTEGRATIONS LEFT THE RAIL (user directive, 2026-09-02: "put the
     integrations into the settings"). It is a Settings section now — the
     page keeps its address, and `SETTINGS_SECTIONS` is what makes the
     Settings tile light up while you stand on it, so the rail learns the
     move from the registry rather than from a second hand-kept list. */
  { href: "/agents", key: "agents", inBar: false },
  /*
   * ECHO IS OFF THE RAIL (user directive, 2026-09-02: "remove echo, we don't
   * need it any more — we need only its parts for future, keep the parts that
   * we need for later").
   *
   * Its routes, its recorder, its transcript surfaces and its section shell
   * all remain: the meeting is being built on those parts, and deleting them
   * to take a tile out of a menu is how a feature loses the thing it was
   * being kept for. What went is the DOOR — nothing links to Echo from the
   * navigation, and the reachability check is satisfied because the pages
   * still resolve for anyone holding a bookmark.
   */
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


/**
 * ONE resolver for the nav's active state, shared by the icon rail and the
 * bottom bar — the two renderings were each carrying their own matcher,
 * which is exactly the drift this file's header warns about, and the drift
 * arrived: the user selected Allowed models and watched the MANAGEMENT
 * tile light up (2026-08-28 screenshot).
 *
 * The cause: Skills and Allowed models live at /management/* but WEAR the
 * Settings pane — their breadcrumb says Settings, their menu is Settings'.
 * An address-prefix match answers "who serves this page", and the rail's
 * question is "whose section is the person standing in". So cross-homed
 * addresses are folded into /settings first, derived from the settings
 * pane's own table (13½: the producer owns the list), and only then does
 * longest-prefix-wins run.
 *
 * "/" would prefix-match every route, so the hub is compared exactly while
 * the rest match by prefix (so /settings/security still lights Settings).
 * LONGEST match wins, and only it — naive per-item matching lit two tiles
 * at once the day the quick-access destinations joined the rail.
 */
export function activeNavHref(pathname: string): string | undefined {
  const crossHomed = SETTINGS_SECTIONS
    .filter((section) => section.href !== undefined)
    .map((section) => section.href!);
  const effective = crossHomed.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  )
    ? "/settings"
    : pathname;
  const candidates = [...NAV_PRIMARY, ...NAV_UTILITY]
    .map((n) => n.href)
    .filter((href) => (href === "/" ? effective === "/" : effective.startsWith(href)));
  return candidates.sort((a, b) => b.length - a.length)[0];
}
