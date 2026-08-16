import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV_PRIMARY, NAV_UTILITY } from "@/components/platform/nav";

/**
 * **A link is a promise.** Every internal href the app renders must resolve
 * inside the route tree — to a page or to a redirect.
 *
 * This exists because the hub shipped an Echo card pointing at `/echo` while
 * the route was still queued behind another session's slice, and the
 * product's main entry 404'd in a user's hands. Both halves were individually
 * correct: the shell rendered the ruled href, the route was honestly not
 * built yet. The failure lived only in the space between two packages, which
 * is exactly where nobody's tests were looking — each session verified its
 * own screens, and nothing verified that the links between them land.
 *
 * A user found it. That's the part this test is here to stop repeating.
 */
const APP = join(process.cwd(), "src", "app");
const LOCALE_ROOT = join(APP, "[locale]");
const SRC = join(process.cwd(), "src");

/**
 * Segment kinds, and they match different numbers of path parts. Getting
 * this wrong produced a FALSE POSITIVE on its first run: `[[...section]]` is
 * an OPTIONAL catch-all, which Next matches at the bare parent path too, so
 * `/settings` resolves even though the only file is
 * `settings/[[...section]]/page.tsx`. Treating it like a required catch-all
 * reported a live 200 as a dead link.
 *
 * A false alarm is worse than a missing check: it teaches everyone to ignore
 * the output, and a muted instrument is indistinguishable from one nobody
 * wrote. So the resolver learns the segment types rather than the route being
 * renamed to suit it.
 */
const DYNAMIC = /^\[[^.].*\]$/; //            [id]        — exactly one part
const CATCH_ALL = /^\[\.\.\..+\]$/; //        [...rest]   — one or more
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/; // [[...rest]] — zero or more

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Every path `[locale]/**` can serve, as segment arrays. A directory counts
 * only if it holds a `page.tsx` — a folder of components is not a route, and
 * treating it as one would make this test pass for the wrong reason.
 */
function servableRoutes(): string[][] {
  const routes: string[][] = [];
  for (const file of walk(LOCALE_ROOT)) {
    if (!file.endsWith("page.tsx")) continue;
    const rel = file.slice(LOCALE_ROOT.length + 1, -"page.tsx".length);
    const segments = rel
      .split(/[\\/]/)
      .filter(Boolean)
      // route groups like (auth) organise files without appearing in the URL
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
    routes.push(segments);
  }
  return routes;
}

/**
 * Every path the BFF can serve — `route.ts` files under `app/api`, as
 * segment arrays INCLUDING the leading `api`. A link may promise an API
 * route too (the OAuth buttons navigate to `/api/auth/oauth/google`), and
 * the promise is kept by a route handler, not a page. Derived from the
 * producer like everything else here: hand-listing the API paths would be
 * the coverage hole the Role-drift guard taught us about.
 */
function servableApiRoutes(): string[][] {
  const routes: string[][] = [];
  for (const file of walk(join(APP, "api"))) {
    if (!/route\.tsx?$/.test(file)) continue;
    const rel = file.slice(APP.length + 1).replace(/route\.tsx?$/, "");
    routes.push(rel.split(/[\\/]/).filter(Boolean));
  }
  return routes;
}

function matches(route: string[], wanted: string[]): boolean {
  for (let i = 0; i < route.length; i++) {
    const seg = route[i]!;
    // a catch-all is the last segment and swallows whatever remains
    if (OPTIONAL_CATCH_ALL.test(seg)) return true; // zero or more → parent path included
    if (CATCH_ALL.test(seg)) return wanted.length > i; // one or more
    if (i >= wanted.length) return false;
    if (!DYNAMIC.test(seg) && seg !== wanted[i]) return false;
  }
  return route.length === wanted.length;
}

/**
 * **The resolver sits between the source and the route tree, and this check
 * has to model it.**
 *
 * Every internal link goes through next-intl's `Link` from `@/i18n/routing`,
 * which prefixes the active locale. So `href="/settings"` in a component is
 * CORRECT source that becomes `/fa/settings` in the DOM — and the route tree
 * is keyed under `[locale]/…`. Comparing the two directly, without accounting
 * for the segment the resolver adds, is what made this check's first
 * real-world fire a FALSE POSITIVE against a page that renders fine.
 *
 * Routes here are already rooted at `[locale]`, so the locale segment is
 * stripped from both sides by construction. An href that arrives WITH a
 * locale prefix (an absolute path someone wrote by hand) is normalised the
 * same way rather than being reported dead.
 */
const LOCALES = ["fa", "en"];

function resolves(href: string, routes: string[][]): boolean {
  const wanted = href.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
  // drop a hand-written locale prefix; the tree is already rooted below it
  if (wanted.length > 0 && LOCALES.includes(wanted[0]!)) wanted.shift();
  return routes.some((route) => matches(route, wanted));
}

/**
 * Internal hrefs written as literals in the source. Template literals with
 * an interpolated id (`/calls/${id}`) are deliberately skipped — the segment
 * count still has to match, so a dynamic route covers them, and trying to
 * evaluate them here would test this regex rather than the app.
 */
function renderedHrefs(): { href: string; file: string }[] {
  const found: { href: string; file: string }[] = [];
  for (const file of walk(SRC)) {
    if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/href=["']([^"'${}]+)["']/g)) {
      const href = match[1]!;
      /*
       * Internal only. `#` is an explicit ALLOW, not an accident: it is the
       * GitHub placeholder for when `NEXT_PUBLIC_GITHUB_URL` is unset, and a
       * deliberate no-op is a different thing from a broken promise. Naming
       * it here means the exclusion is a decision on the record rather than
       * a silence someone later mistakes for coverage.
       */
      if (href === "#") continue;
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      found.push({ href, file: file.slice(SRC.length + 1) });
    }
  }
  return found;
}

/**
 * The nav modules' hrefs, imported rather than scanned.
 *
 * The literal scanner missed these entirely — they come from `NAV_PRIMARY` /
 * `NAV_UTILITY`, which are variables, so the shell's whole primary nav was
 * invisible to a check whose whole point is permanent chrome. That is the
 * inverse seam: a consumer with no producer, and it hid a genuinely 404ing
 * `/help` link on every screen while the suite stayed green.
 *
 * Importing beats scanning here — a scanner can be outrun by any refactor
 * that moves a string, whereas this breaks loudly if the module's shape
 * changes.
 */
function navHrefs(): { href: string; file: string }[] {
  return [...NAV_PRIMARY, ...NAV_UTILITY]
    .map((item) => item.href)
    // GITHUB_HREF is external (or "#" when unset) — not ours to resolve
    .filter((href) => href.startsWith("/"))
    .map((href) => ({ href, file: "components/platform/nav.ts" }));
}

describe("every internal href resolves in the route tree", () => {
  const routes = servableRoutes();
  const apiRoutes = servableApiRoutes();

  it("finds the route tree at all", () => {
    // if this is empty the whole suite would pass by testing nothing
    expect(routes.length).toBeGreaterThan(5);
    expect(apiRoutes.length).toBeGreaterThan(5);
  });

  it("finds hrefs to check", () => {
    expect(renderedHrefs().length).toBeGreaterThan(5);
  });

  it("covers the shell's nav, which is where a dead link hurts most", () => {
    // permanent chrome on every screen — if this list is empty the check has
    // silently stopped seeing the nav, which is how /help stayed hidden
    expect(navHrefs().length).toBeGreaterThan(3);
  });

  it("has no link pointing at a route that does not exist", () => {
    const dead = [...renderedHrefs(), ...navHrefs()].filter(({ href }) => {
      // an /api/ href promises a ROUTE HANDLER; everything else, a page. The
      // api tree keeps its literal `api` segment, so match against the raw
      // path (no locale stripping — the BFF lives outside [locale]).
      if (href === "/api" || href.startsWith("/api/")) {
        const wanted = href.split("?")[0]!.split("/").filter(Boolean);
        return !apiRoutes.some((r) => matches(r, wanted));
      }
      return !resolves(href, routes);
    });
    // name the file too — "some link is dead" is a worse report than "this one"
    expect(dead.map((d) => `${d.href}  ← ${d.file}`)).toEqual([]);
  });

  it("still fires on an api href with no handler behind it (the upgrade did not blunt it)", () => {
    // the checker's own negative control: a plausible-looking BFF path that
    // does not exist must be reported dead, or the api branch above is
    // ambience wearing a check's clothes. NOT /api/auth/oauth/anything —
    // `[provider]` is dynamic and matches every name by design (the HANDLER
    // refuses unknown providers; a tree check cannot see that and must not
    // pretend to).
    const wanted = "/api/auth/no-such-flow".split("/").filter(Boolean);
    expect(apiRoutes.some((r) => matches(r, wanted))).toBe(false);
  });
});
