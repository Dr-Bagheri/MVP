import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_TRAIL, TRAIL, patternFor, trailFor } from "./trail";
import { SETTINGS_SECTIONS } from "./settingsSections";

/**
 * The trail is the platform's only back-navigation, so the failure that costs
 * the most is a page that quietly has none — a new route lands, nobody adds a
 * crumb, and the user is stranded on exactly the deep page they were stranded
 * on before. That is a SEAM, and rule 13½ says a seam gets an instrument
 * rather than a convention.
 *
 * So the coverage check below is derived from the filesystem, not from a
 * hand-written list of routes: a list is a second thing to remember, and the
 * whole failure mode is forgetting.
 */
const LOCALE_ROOT = join(process.cwd(), "src", "app", "[locale]");
const MESSAGES = join(process.cwd(), "src", "messages");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Route patterns the app can serve, as `/a/[b]` strings rooted below the locale. */
function servableRoutes(): string[] {
  const routes: string[] = [];
  for (const file of walk(LOCALE_ROOT)) {
    if (!file.endsWith("page.tsx")) continue;
    const segments = file
      .slice(LOCALE_ROOT.length + 1, -"page.tsx".length)
      .split(/[\\/]/)
      .filter(Boolean)
      // route groups like (auth) organise files without appearing in the URL
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
      // an optional catch-all serves its PARENT path, which is the address the
      // trail is about: settings/[[...section]] is reached as /settings
      .filter((s) => !s.startsWith("[["));
    routes.push("/" + segments.join("/"));
  }
  return routes;
}

/**
 * A route is covered if some trail pattern matches it, or if it is excluded
 * with a stated reason. Returns the uncovered ones so a failure NAMES them —
 * "a route is uncovered" is a worse report than "this route is".
 */
function uncovered(routes: string[]): string[] {
  return routes.filter((route) => {
    if (NO_TRAIL[route] !== undefined) return false;
    // a concrete probe path, so `[id]`-style routes exercise the real matcher
    const probe = route.replace(/\[[^\]]+\]/g, "x");
    return patternFor(probe) === undefined;
  });
}

function messageKeyExists(catalogue: Record<string, unknown>, key: string): boolean {
  let node: unknown = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

describe("breadcrumb trail", () => {
  it("puts the ancestors above the page, root first", () => {
    expect(trailFor("/management/users")).toEqual([
      /* MANAGEMENT is its own root (user directive, 2026-08-28: "for echo
         and management, they are the main roots") — the rail's three icons
         are three domains, and a trail opening every Management page with
         "Assistant /" claimed a hierarchy the rail contradicts */
      { href: "/management", label: "platform.management" },
      { href: "/management/users", label: "management.section.users" },
    ]);
  });

  it("hangs Echo's surfaces under Echo, which the URL does not say", () => {
    // the reason this table exists at all: a path-derived trail renders
    // "Home > Search" and teaches an IA the rest of the product contradicts
    expect(trailFor("/search").map((c) => c.href)).toEqual(["/echo", "/search"]);
  });

  it("does NOT route a call through /calls, which is now only a redirect", () => {
    /*
     * The merged Record+Calls surface landed at `/echo` and `/calls` became a
     * redirect onto it. A crumb labelled «تماس‌ها» pointing at `/calls` would
     * be a step naming a place that no longer exists AND a link whose
     * destination disagrees with its label — so the trail goes straight to
     * Echo. Asserted as an absence, because the wrong version renders
     * perfectly and only the extra crumb gives it away.
     */
    const trail = trailFor("/calls/0c5c0e02-1111-2222-3333-444455556666");
    // 2026-08-25 (user report): the chain names Records between Echo and the
    // record — Home / Echo / Records / <title> — via the STATIC
    // /echo/records entry (a parent must never be a dynamic pattern)
    expect(trail.map((c) => c.href)).toEqual([
      "/echo",
      "/echo/records",
      "/calls/0c5c0e02-1111-2222-3333-444455556666",
    ]);
    expect(trail.map((c) => c.href)).not.toContain("/calls");
    expect(trail.at(-1)).toEqual({
      href: "/calls/0c5c0e02-1111-2222-3333-444455556666",
      entity: true,
    });
    // an entity crumb must NOT carry a label key — rendering one would put a
    // translation string where the call's own title belongs
    expect(trail.at(-1)!.label).toBeUndefined();
  });

  it("builds a section label from the slug, so a new section gets a crumb by existing", () => {
    expect(trailFor("/settings/audit-logs").at(-1)!.label).toBe("settings.section.audit-logs");
  });

  it("returns nothing for a route with no trail", () => {
    expect(trailFor("/sign-in")).toEqual([]);
  });

  it("keeps the concrete path on the leaf and static patterns above it", () => {
    // the leaf's href is never rendered as a link, but it is the page's own
    // address; an ancestor rendering a literal "[id]" would be a dead link
    const trail = trailFor("/settings/security");
    expect(trail.every((c) => !c.href.includes("["))).toBe(true);
  });
});

describe("the trail's own assumptions", () => {
  it("has no dynamic pattern as anyone's parent", () => {
    /*
     * `trailFor` uses the pattern string itself as an ancestor's href, which is
     * only safe while every ancestor is static. This is the assertion that
     * makes that assumption fail loudly instead of shipping a URL with a
     * literal `[id]` in it.
     */
    const parents = Object.values(TRAIL)
      .map((e) => e.parent)
      .filter((p): p is string => p !== undefined);
    expect(parents.filter((p) => p.includes("["))).toEqual([]);
  });

  it("reaches one of the three domain roots from every entry", () => {
    /*
     * The IA's roots, 2026-08-28 (two rulings the same day): the rail's
     * three domains — Assistant (/), Echo, Management — plus Settings,
     * Profile and Help, which the user named main pages in their own
     * right. The root SET is pinned
     * first, derived from the table itself: a fourth parentless entry is a
     * new root nobody declared, and a typo that drops a parent would
     * otherwise read as "reachable" while quietly re-rooting a page.
     */
    const roots = Object.entries(TRAIL)
      .filter(([, entry]) => entry.parent === undefined)
      .map(([pattern]) => pattern)
      .sort();
    /* every RAIL entry is a root now (user directive, 2026-09-02: "the first
       is the name of the section they are in; for most of them it is
       Dashboard — fix it"): Meetings, Tasks, the Assistant, Agents and
       Workflows each begin their own trail, as Echo and Management already
       did, and the console is a room of its own */
    expect(roots).toEqual([
      "/", "/agents", "/assistant", "/echo", "/help", "/management",
      "/meetings", "/platform", "/profile", "/settings", "/tasks", "/workflows",
    ]);
    for (const pattern of Object.keys(TRAIL)) {
      const trail = trailFor(pattern.replace(/\[[^\]]+\]/g, "x"));
      expect(trail.length, `${pattern} produced no trail`).toBeGreaterThan(0);
      expect(roots, `${pattern} does not reach a declared root`)
        .toContain(trail[0]!.href);
    }
  });
});

describe("every servable route has a trail or a stated reason", () => {
  const routes = servableRoutes();

  it("finds the route tree at all", () => {
    // without this the coverage check below passes by checking nothing
    expect(routes.length).toBeGreaterThan(10);
  });

  it("covers every route", () => {
    expect(uncovered(routes)).toEqual([]);
  });

  it("REPORTS an uncovered route — the check can fail for its own reason", () => {
    /*
     * The negative control. Coverage checks are the ones that go vacuous
     * quietly: this one would report "all covered" just as cheerfully if the
     * matcher returned a pattern for everything. Asking it about a route that
     * genuinely has no crumb is the only question it can answer NO to.
     */
    expect(uncovered(["/a-route-nobody-gave-a-crumb"])).toEqual([
      "/a-route-nobody-gave-a-crumb",
    ]);
  });

  it("states a reason for every exclusion, rather than excluding silently", () => {
    for (const [route, reason] of Object.entries(NO_TRAIL)) {
      expect(reason.length, `${route} is excluded with no reason`).toBeGreaterThan(20);
    }
  });
});

describe("every crumb label resolves in BOTH catalogues", () => {
  /*
   * Persian-first means the default path is the one that hides the bug: a key
   * present in fa.json and missing in en.json renders perfectly for whoever
   * wrote it and shows a raw key path to everyone else. The locale corollary,
   * applied to the labels this component cannot render without.
   */
  const fa = JSON.parse(readFileSync(join(MESSAGES, "fa.json"), "utf8")) as Record<string, unknown>;
  const en = JSON.parse(readFileSync(join(MESSAGES, "en.json"), "utf8")) as Record<string, unknown>;

  const labels = Object.entries(TRAIL).flatMap(([pattern, entry]) => {
    if (entry.label) return [entry.label];
    if (!entry.labelPrefix) return [];
    // section routes: every sibling route that resolves here contributes a key
    return servableRoutes()
      .filter((route) => patternFor(route.replace(/\[[^\]]+\]/g, "x")) === pattern)
      .map((route) => `${entry.labelPrefix}.${route.split("/").filter(Boolean).at(-1)}`);
  });

  it("found labels to check", () => {
    expect(labels.length).toBeGreaterThan(8);
  });

  it.each(["fa", "en"])("%s has every label", (locale) => {
    const catalogue = locale === "fa" ? fa : en;
    expect(labels.filter((key) => !messageKeyExists(catalogue, key))).toEqual([]);
  });
});

describe("a crumb that says Settings is a promise Settings can keep", () => {
  /*
   * THE ROT THIS CATCHES, found 2026-09-03 and true for months before that.
   * Skills, Connectors and Service health each left the Settings menu on the
   * user's own word, one at a time, months apart. Their pages stayed at
   * /management/* and their crumbs stayed "Settings ›" — so the trail offered
   * a door back to a menu that no longer lists the page you are standing on.
   * Nothing went red: every route still resolved, every label still existed,
   * every crumb still rendered. The trail's coverage check asks whether a
   * page HAS a parent; it never asked whether the parent was TRUE.
   *
   * The list is derived from SETTINGS_SECTIONS — the menu's own registry, the
   * producer (13½) — rather than hand-enumerated beside it, because a
   * hand-written copy is the seam that drifted in the first place.
   */
  const claimedBySettings = new Set(
    SETTINGS_SECTIONS.map((s) => s.href ?? `/settings/${s.slug}`),
  );

  /* CONCRETE paths only. `/settings/[section]` is the pattern the registry's
     own rows resolve THROUGH — every one of its instances is a `/settings/…`
     slug the menu lists — so reading it as an orphan is the checker accusing
     the menu of not listing itself. That was this guard's first red, caught
     before it was believed: a checker that manufactures false positives is
     muted inside a week and is then worse than absent. */
  const pointingAtSettings = Object.entries(TRAIL)
    .filter(([path, node]) => node.parent === "/settings" && path !== "/settings")
    .map(([path]) => path)
    .filter((path) => !path.includes("["));

  it("has something to check", () => {
    /* the vacuum guard: if the filter matched nothing — a renamed parent, a
       reshaped TRAIL — every assertion below would pass by having no subject */
    expect(pointingAtSettings.length).toBeGreaterThan(0);
    expect(claimedBySettings.size).toBeGreaterThan(0);
  });

  it("only lets a page claim Settings as its parent when the Settings menu offers it", () => {
    const orphans = pointingAtSettings.filter((path) => !claimedBySettings.has(path));
    expect(
      orphans,
      `these say "Settings ›" but the Settings menu does not list them, so the crumb ` +
      `leads to a pane without that row: ${orphans.join(", ")}. Either add the section ` +
      `to SETTINGS_SECTIONS, or point the crumb at the section the page lives in.`,
    ).toEqual([]);
  });

  it("can answer NO — a page the menu does not offer is reported", () => {
    /* The negative control, and the reason the assertion above means anything:
       "no orphans" also holds when the two sets are read wrongly and both come
       back empty. This stages exactly the state that shipped — a /management
       page pointing at Settings with no menu row — and demands the same
       comparison fail. */
    const staged = [...pointingAtSettings, "/management/skills"];
    const orphans = staged.filter((path) => !claimedBySettings.has(path));
    expect(orphans).toContain("/management/skills");
  });
});
