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
   * The landing page is the DASHBOARD again (user directive, 2026-08-29:
   * "now bring back the dashboard as well"), and the assistant is a
   * destination under it at its own address. The root crumb names the room
   * a person actually lands in — a crumb pointing at a redirect is a label
   * whose destination is a different page, which is the /calls lesson.
   */
  "/": { label: "platform.dashboard" },
  /*
   * EVERY RAIL ENTRY IS A ROOT (user directive, 2026-09-02: "fix the address
   * bar … the first is the name of the section they are in; for most of them
   * it is Dashboard — fix it"). Meetings, Tasks, the Assistant, Agents and
   * Workflows each had `parent: "/"`, so every one of their pages opened its
   * trail with «داشبورد /» — a hierarchy the rail contradicts, exactly the
   * argument that already made Echo, Management and Settings roots. The
   * dashboard is a room of its own, not the parent of the others.
   */
  "/assistant": { label: "platform.assistant" },
  "/tasks": { label: "platform.tasks" },
  "/meetings": { label: "platform.meetings" },
  "/meetings/[id]": { entity: true, parent: "/meetings" },
  /* 0181 — projects. The detail crumb is the project's NAME, fed by the
     page through useCrumbTitle; `entity` is what says the label is data. */
  "/chat": { label: "platform.chat" },
  "/projects": { label: "platform.projects" },
  "/projects/[id]": { entity: true, parent: "/projects" },

  /* the connected accounts a workflow runs on, beside the workflows */
  /* under SETTINGS now — that is the menu the page wears (2026-09-02), and
     a trail that said Workflows while the toolbar said Settings is the
     redirect lesson again */
  /* A ROOT AGAIN (user directive, 2026-09-03): Integrations is a rail
     destination beside Agents, so "Settings ›" is a door back to a menu that
     no longer lists it — the crumb follows whichever menu claims the page,
     and none does above it now. (trail.test.ts asserts exactly this: a page
     may only claim Settings as its parent while the Settings registry
     offers it.) */
  "/integrations": { label: "platform.integrations" },
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
  /**
   * **A RECORD HANGS UNDER MEETINGS NOW** (user directive, 2026-09-04: the
   * Echo surface is gone).
   *
   * Its parent was `/echo/records`, which no longer resolves — and a crumb
   * naming a place that does not exist is worse than a shorter trail: the
   * step is there, it is labelled, and pressing it is a 404. A recording
   * belongs to the meeting it came from, so the trail says so, and `/calls`
   * redirects to the same place for anyone holding an old link.
   */
  "/calls/[id]": { entity: true, parent: "/meetings" },
  "/search": { label: "search.title" },

  /* a root for the same reason as /echo — see the note there */
  "/management": { label: "platform.management" },
  /* THE CRUMB FOLLOWS WHICHEVER MENU CLAIMS THE PAGE, and falls back to
     the URL when none does.
        Models wears the Settings menu (SETTINGS_SECTIONS carries it with an
     absolute href), so its crumb says Settings — the original rule, and
     still right: a crumb that says Management while the menu says Settings
     is the redirect lesson again, the route resolving while the trail
     quietly lies about where you are.
        Skills, Connectors and Service health are the case that rule did not
     cover. Each was taken OUT of the Settings menu on the user's own word
     (Service health 2026-08-26, Connectors 2026-08-28 — Integrations is
     that door now, Skills 2026-09-02) and no menu picked them up, so
     "Settings ›" had become a promise the Settings pane cannot keep: follow
     it and the row you came from is not there. Their crumb is now the
     section they actually live in, which is the user's own stated rule for
     the trail (2026-09-02: "the first is name of the section that they are
     in"). Derived by hand rather than from the registry deliberately — a
     menu-less page has no producer to derive from, which is exactly why it
     needs a written reason. */
  "/management/skills": { label: "management.section.skills", parent: "/management" },
  "/management/models": { label: "management.section.models", parent: "/settings" },
  "/management/connectors": { label: "management.section.connectors", parent: "/management" },
  "/management/server": { label: "management.section.server", parent: "/management" },
  /* Speakers moved INTO Management (2026-09-02) and keeps the label it had
     under Echo — the word is the same, only the room changed */
  "/management/speakers": { label: "echo.section.speakers", parent: "/management" },
  "/management/[section]": { labelPrefix: "management.section", parent: "/management" },

  /* roots, like /echo and /management (user directive, 2026-08-28: "still
     assistant / profile and assistant / setting. these are the main pages
     as well, and assistant / help") — the trail's root set is pinned in
     trail.test.ts, so a stray parentless entry cannot join unnoticed */
  "/settings": { label: "platform.settings" },
  "/settings/[section]": { labelPrefix: "settings.section", parent: "/settings" },

  /* the assistant's own history — its section is the Assistant, not the
     dashboard */
  "/conversations": { label: "conversations.title", parent: "/assistant" },
  "/agents": { label: "platform.agents" },
  /** db/0164 — one ROOM. The leaf is the room's own title (entity), supplied
   *  by the page: a room is a thing a person named, so the crumb is data. */
  "/agents/[id]": { entity: true, parent: "/agents" },
  "/workflows": { label: "platform.workflows" },
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
  "/platform": { label: "platformRoot.title" },
  "/profile": { label: "profile.title" },
  "/help": { label: "platform.help" },
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
  /*
   * THE GUEST DOOR (0158). Outside the shell for the same reason as the auth
   * screens and one more: the person here has no account and never will, so
   * every crumb would be a link into a product that would refuse them. The
   * one screen where offering a way "up" is offering a wall.
   */
  "/join/[code]": "a guest holds a capability for one room and nothing else — every ancestor would refuse them",
  /*
   * THE COMPANY'S FRONT PAGE (2026-09-05). Outside the shell for the guest
   * door's reason exactly: the reader has no account yet, so every crumb
   * would point at a surface that refuses them. Its only link IS the trail
   * — «ورود», at the top.
   */
  "/home": "the public front page — the reader has no session, so every ancestor would refuse them",
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
