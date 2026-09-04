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
  /**
   * The path prefix that LIGHTS this entry, when that is not its href.
   *
   * Where a link goes and what it highlights are two different facts, and
   * they came apart on 2026-09-03: Management's href moved to its first page
   * (`/management/general`) to stop the section's redirect costing a round
   * trip, and a prefix match on that href would have left the tile dark on
   * every other Management page. `match: "/management"` says the territory
   * out loud instead of inferring it from the destination.
   */
  match?: string;
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
  /*
   * PROJECTS IS NOT IN THE RAIL (user directive, 2026-09-05: "remove projects
   * from the menu too").
   *
   * It was added here on 2026-09-04 and the same week's directive moved the
   * door: an admin reaches /projects from the BOARD'S toolbar, beside the
   * folders the page is about, and a member reaches a project by opening its
   * card. The rail is for places every reader has a reason to go, and after
   * 0186 made projects an admin's surface this was not one of them.
   *
   * The ROUTE stays — a rail entry is a door, not the room, and the trail,
   * the reachability check and every existing link still resolve.
   */
  /*
   * 0184 — the TEAM CHANNEL (user directive, 2026-09-04: "add a chat room
   * section in the menu for all members to join and a place that they can
   * talk to each other").
   *
   * It is a rail destination and not a corner of the assistant, and that
   * distinction is the whole feature: this is where COLLEAGUES talk, and an
   * assistant session belongs to exactly one person by construction. The
   * agents are guests in the room rather than the reason for it.
   */
  /* CHAT IS NOT IN THE RAIL EITHER (user directive, 2026-09-05: "add a
     small icon with the same size as switch theme near it for the chat
     section, and remove it from the menu as well").

     Its door is the top bar now, beside the theme toggle — chrome that
     is one press away from every screen, which is what a room people
     drop into all day should be. The ROUTE and the trail entry stay:
     a rail entry is a door, not the room. */
  /* THE ASSISTANT LEFT THIS LIST (user directive, 2026-09-03: "change [the
     green button] to the assistant and remove the assistant access in the
     menu"). It is the rail's PRIMARY action now — the green button at the top
     — and a product whose main verb is "ask" should not also list asking as a
     row further down. The address, the trail entry and every bookmark are
     unchanged; only this row went.

     `activeNavHref` therefore matches nothing on /assistant, so no row lights
     there — correct, since the lit row would name a destination the menu no
     longer offers. */
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
   * INTEGRATIONS IS A RAIL DESTINATION AGAIN (user directive, 2026-09-03: "i
   * need the integrations to come to the menu from the setting under the
   * agents"). It sat in the Settings menu from 2026-09-02; what a connection
   * IS turns out to belong beside the agents that use it rather than beside
   * the org's configuration — an agent without its connections can do
   * nothing, and the two were a menu apart.
   */
  { href: "/integrations", key: "integrations", inBar: false },
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
  /*
   * THE RAIL POINTS AT THE SECTION'S FIRST PAGE, not at the section (user
   * report, 2026-09-03: "the management section when i go to it refresh the
   * whole platform ... it feels different from other section like meetings").
   *
   * It did, and the cause was one line away: `/management/page.tsx` is a
   * SERVER component whose whole body is `redirect({ href:
   * "/management/general" })`. So pressing Management asked the server for a
   * page, got a redirect back, and asked again — a round trip and a second
   * load before anything rendered, where /meetings renders on the first ask.
   * Settings never had the problem because its home is an optional
   * catch-all (`[[...section]]`) that renders its first section directly.
   *
   * The redirect STAYS for anyone holding a bookmark to /management — what
   * changes is that the ordinary path no longer walks through it. A link is
   * a promise, and one that costs a round trip is a slower promise than the
   * one beside it.
   */
  { href: "/management/general", key: "management", inBar: true, match: "/management" },
];

/**
 * The rail's bottom group: low-frequency destinations. They do not earn
 * permanent slots on a phone and live behind "More" there instead.
 */
export const NAV_UTILITY: readonly NavItem[] = [
  { href: "/settings", key: "settings", inBar: false },
  { href: "/help", key: "help", inBar: false },
  /*
   * NO GITHUB (user directive, 2026-09-04: "remove GitHub from the menu").
   *
   * It was the one entry in the navigation that left the product, and it sat
   * in a group of two destinations somebody uses inside it. `GITHUB_HREF`
   * stays exported and is not orphaned: the help page still offers the
   * repository as a card, which is where a link out belongs — on a page about
   * the project rather than in the rail somebody navigates with.
   */
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
  /* an entry is lit by its TERRITORY (`match`) and navigates to its `href` —
     the two are the same for every entry but Management, whose href is its
     first page so that pressing it does not walk through a server redirect */
  const candidates = [...NAV_PRIMARY, ...NAV_UTILITY]
    .filter((n) => {
      const territory = n.match ?? n.href;
      return territory === "/" ? effective === "/" : effective.startsWith(territory);
    })
    .map((n) => n.href);
  return candidates.sort((a, b) => b.length - a.length)[0];
}
