/**
 * The breadcrumb trail — the platform's ONE back-navigation mechanism (user
 * directive, review round 2).
 *
 * The user asked for back-navigation twice; the per-page back button proposed
 * in round 1 never became visible to them, and the ruling retired it before it
 * shipped. One mechanism, not two: the ancestors in this trail ARE the back
 * navigation, so there is no second control that can disagree with them about
 * where "up" is.
 *
 * **Why a declared table and not the URL.** The obvious implementation splits
 * the pathname and calls each segment a crumb. It is wrong here for a reason
 * that is structural rather than cosmetic: `/calls` sits under **Echo** in the
 * product's information architecture, and the URL does not say so. A
 * path-derived trail would render `Home › Calls` and quietly teach a different
 * IA than the one the rail, the hub cards and the pivot all describe. The
 * trail is a claim about where things live, so it is written down where it can
 * be read and tested, next to the routes it describes.
 *
 * Kept deliberately free of React so the derivation is testable as a function —
 * the interesting failures here are "which crumbs", not "how they render".
 */

/** A route pattern's place in the trail. */
interface TrailEntry {
  /**
   * Full message key for this crumb's label (dotted — real nesting in the
   * catalogue, not the flat-key workaround the gateway event labels needed).
   */
  label?: string;
  /**
   * Label key built as `${labelPrefix}.${lastSegment}` — for section routes
   * whose slug already names a catalogue entry. Beats one entry per section:
   * a new settings section gets its crumb by existing.
   */
  labelPrefix?: string;
  /** The crumb's text is DATA and the page supplies it (see `useCrumbTitle`). */
  entity?: boolean;
  /** Route pattern of the crumb above this one. Only the root omits it. */
  parent?: string;
}

/**
 * Keys are route patterns rooted below the locale segment, in the same
 * `[param]` notation as the route tree, so this table can be diffed against
 * the filesystem by `breadcrumbs.test.ts` rather than trusted.
 */
export const TRAIL: Readonly<Record<string, TrailEntry>> = {
  /*
   * The landing page is the ASSISTANT again (user directive, 2026-08-27:
   * "deactivate dashboard for now, we will use it later"). `/` redirects to
   * `/assistant`, so the root crumb names the room a person actually lands
   * in — a crumb pointing at a redirect is a label whose destination is a
   * different page, which is the /calls lesson.
   */
  "/": { label: "platform.assistant" },

  /* the connected accounts a workflow runs on, beside the workflows */
  "/integrations": { label: "platform.integrations", parent: "/workflows" },
  /** one integration's detail (M47) — the leaf is the integration's own
   *  localized name, supplied by the page (entity), and the parent crumb IS
   *  Sana's "< All integrations" back link in the platform's one mechanism */
  "/integrations/[slug]": { entity: true, parent: "/integrations" },

  /*
   * Echo is an app inside the platform (the pivot), so everything of Echo's
   * hangs beneath it.
   *
   * `/echo` currently redirects onward to `/calls` — an interim stand-in for
   * the merged Record+Calls surface that has not landed. That makes the Echo
   * crumb briefly a near-no-op from inside Calls, which is the correct
   * temporary state: the trail expresses the IA, and the redirect is the thing
   * that is temporary. Special-casing it here would have to be undone the week
   * the merged surface lands.
   */
  /*
   * ECHO IS A ROOT, not a room inside the assistant (user directive,
   * 2026-08-28: "for echo and management, they are the main roots"). The
   * rail's three icons are three domains — Assistant, Echo, Management —
   * and a trail that opened every Echo page with "Assistant /" claimed a
   * hierarchy the rail itself contradicts. No parent = the domain's own
   * name is where its trail begins.
   */
  "/echo": { label: "platform.echo" },
  /** Echo's sections (Part 5): the same anatomy as Settings, so the same
   *  trail shape — the slug builds the leaf label. */
  "/echo/[section]": { labelPrefix: "echo.section", parent: "/echo" },
  /* static twin of the [section] entry so a RECORD's trail can name it as
     an ancestor (user report, 2026-08-25: Home / Echo / <title> skipped
     Records) — parents must be static keys, and patternFor prefers the
     static match, so visiting /echo/records lands here with the same label */
  "/echo/records": { label: "echo.section.records", parent: "/echo" },
  /**
   * **`/calls/[id]`'s parent is `/echo`, not `/calls`.**
   *
   * The merged Record+Calls surface landed at `/echo`, and `/calls` became a
   * redirect onto it. Leaving the old parent would render a crumb labelled
   * «تماس‌ها» that navigates to `/echo` — a step in the trail naming a place
   * that no longer exists, and a link whose destination disagrees with its
   * label. The list of calls IS the Echo surface now, so the trail says so.
   */
  "/calls/[id]": { entity: true, parent: "/echo/records" },
  "/search": { label: "search.title", parent: "/echo" },

  /* a root for the same reason as /echo — see the note there */
  "/management": { label: "platform.management" },
  /* the four assistant/service sections wear the SETTINGS menu now (user
     directive, 2026-08-26) and their pages did not move, so the TRAIL has
     to follow the menu rather than the URL: a crumb that says Management
     while the menu says Settings is the redirect lesson again — the route
     resolves, every reachability check stays green, and the trail quietly
     lies about where you are. */
  "/management/skills": { label: "management.section.skills", parent: "/settings" },
  "/management/models": { label: "management.section.models", parent: "/settings" },
  "/management/connectors": { label: "management.section.connectors", parent: "/settings" },
  "/management/server": { label: "management.section.server", parent: "/settings" },
  "/management/[section]": { labelPrefix: "management.section", parent: "/management" },

  "/settings": { label: "platform.settings", parent: "/" },
  "/settings/[section]": { labelPrefix: "settings.section", parent: "/settings" },

  "/conversations": { label: "conversations.title", parent: "/" },
  "/agents": { label: "platform.agents", parent: "/" },
  "/workflows": { label: "platform.workflows", parent: "/" },
  /** M41 P1 — one run's ledger; the leaf is the workflow's name (entity). */
  "/workflows/runs/[id]": { entity: true, parent: "/workflows" },
  /**
   * One workflow: what it does, and what it has done. The leaf is the
   * workflow's own name (entity), so `/workflows/runs` — a static sibling —
   * keeps winning over this pattern in `patternFor`, which prefers the less
   * dynamic match.
   */
  "/workflows/[handle]": { entity: true, parent: "/workflows" },
  /** M32's separate metadata-only operator console. */
  "/platform": { label: "platformRoot.title", parent: "/" },
  "/profile": { label: "profile.title", parent: "/" },
  "/help": { label: "platform.help", parent: "/" },
  /** Help's guide sections (2026-08-16) — same anatomy as Settings/Echo. */
  "/help/[section]": { labelPrefix: "help.section", parent: "/help" },
};

/**
 * Routes that deliberately render no trail, each with the reason.
 *
 * An exclusion list without reasons is a silence someone later mistakes for
 * coverage — the same argument that put `#` on the record in `routes.test.ts`
 * rather than letting it be skipped quietly.
 */
export const NO_TRAIL: Readonly<Record<string, string>> = {
  "/assistant": "the root's own destination (`/` redirects here): a crumb would read \"Assistant / Assistant\", and a one-crumb trail is a label that navigates nowhere",
  "/sign-in": "auth screens render outside the shell — there is no bar to hold a trail, and no 'up' from signing in",
  "/sign-up": "auth screens render outside the shell",
  "/pending": "auth screens render outside the shell",
  /*
   * Outside the shell like its siblings — and doubly so: there is no 'up' from
   * here BY DESIGN. Nothing in the product is reachable while the organisation
   * is switched off, so a crumb offering a way back in would be a link that
   * cannot work, on the one screen whose whole job is to say it cannot.
   */
  "/suspended": "auth screens render outside the shell; and no 'up' exists while the org is suspended",
  "/forgot": "auth screens render outside the shell — reached while signed out, by someone who cannot get in",
  "/reset": "auth screens render outside the shell; reached from an emailed link, with no in-product ancestor",
  "/skills": "redirect-only (→ /management/skills); the destination carries the trail",
  "/connectors": "redirect-only (→ /management/connectors)",
  "/admin": "redirect-only (→ /management)",
  "/calls": "redirect-only (→ /echo) since the merged Record+Calls surface landed; the calls list IS the Echo surface now, so /echo carries the trail",
  "/capture": "redirect-only (→ /echo); recording moved onto the merged surface",
};

export interface Crumb {
  /** Concrete href for this crumb. The last crumb is never rendered as a link. */
  href: string;
  /** Message key, when the label comes from the catalogue. */
  label?: string;
  /** The page supplies this crumb's text. */
  entity?: boolean;
}

/** Split a concrete pathname (locale already stripped) into segments. */
function segmentsOf(pathname: string): string[] {
  return pathname.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
}

function patternMatches(pattern: string, segments: string[]): boolean {
  const parts = segmentsOf(pattern);
  if (parts.length !== segments.length) return false;
  return parts.every((part, i) => (part.startsWith("[") ? true : part === segments[i]));
}

/**
 * The route pattern a concrete pathname belongs to, or `undefined`.
 *
 * Static segments win over dynamic ones: `/management/users` must resolve to
 * itself and not to `/management/[section]` if both were ever listed, because
 * the more specific entry is the one carrying the more specific label.
 */
export function patternFor(pathname: string): string | undefined {
  const segments = segmentsOf(pathname);
  const candidates = Object.keys(TRAIL).filter((p) => patternMatches(p, segments));
  if (candidates.length === 0) return undefined;
  const dynamism = (p: string) => segmentsOf(p).filter((s) => s.startsWith("[")).length;
  return candidates.sort((a, b) => dynamism(a) - dynamism(b))[0];
}

/**
 * The trail for a pathname, root first, current page last.
 *
 * Ancestor hrefs are the patterns themselves, which is correct only because
 * every ancestor in this table is static. If a dynamic ancestor is ever added
 * (`/calls/[id]/parts`, say), its href has to be rebuilt from the concrete
 * segments — the test below asserts that no dynamic pattern is anyone's
 * parent, so this assumption fails loudly rather than rendering a literal
 * `[id]` in a URL.
 */
export function trailFor(pathname: string): Crumb[] {
  const pattern = patternFor(pathname);
  if (pattern === undefined) return [];

  const crumbs: Crumb[] = [];
  const segments = segmentsOf(pathname);
  let current: string | undefined = pattern;
  let isLeaf = true;

  while (current !== undefined) {
    const entry: TrailEntry = TRAIL[current]!;
    const label = entry.labelPrefix
      ? `${entry.labelPrefix}.${segments[segmentsOf(current).length - 1]}`
      : entry.label;
    crumbs.unshift({
      // the leaf keeps the concrete pathname; ancestors are static patterns
      href: isLeaf ? `/${segments.join("/")}` : current,
      ...(entry.entity ? { entity: true } : {}),
      ...(label ? { label } : {}),
    });
    isLeaf = false;
    current = entry.parent;
  }
  return crumbs;
}
