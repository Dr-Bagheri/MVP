import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGABLE } from "./agentSurface";
// the PRODUCER's own enum, imported rather than re-typed
import { CLIENT_TOOLS } from "../../../core/src/agent/client-tools";

/**
 * EVERY PLACE THE AGENTS CAN BE SENT MUST EXIST.
 *
 * User report, 2026-09-04: "i asked roya to start a meeting but it went to
 * echo platform that we already removed."
 *
 * She obeyed the map she was given. The `navigate` enum predated meetings,
 * tasks and integrations entirely, so the closest destination to "start a
 * meeting" was `/echo` — the recorder. And `/echo/speakers` was still listed
 * months after that address became a redirect to Management.
 *
 * `agentSurface.seam.test.ts` already checks the enum against `NAVIGABLE`, and
 * that check passed the whole time: both sides agreed with each other and
 * neither agreed with the app. A regex is a claim about the SHAPE of a path.
 * This one asks the filesystem.
 *
 * The three-way check is the point — enum ⊆ NAVIGABLE ⊆ the route tree — so a
 * destination cannot be added to one and forgotten in the others.
 */
const APP = join(process.cwd(), "src", "app", "[locale]");

/** every path the app can actually serve, as a set of literal routes */
function realRoutes(dir = APP, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    /* a route GROUP — `(auth)` — adds no segment */
    const segment = /^\(.*\)$/.test(entry) ? prefix : `${prefix}/${entry}`;
    if (existsSync(join(full, "page.tsx"))) out.add(segment === "" ? "/" : segment);
    for (const nested of realRoutes(full, segment)) out.add(nested);
  }
  if (prefix === "" && existsSync(join(APP, "page.tsx"))) out.add("/");
  return out;
}

/**
 * Does the app serve this path?
 *
 * A catch-all (`[[...section]]`) serves its parent and everything under it, so
 * `/settings/general` resolves through `/settings/[[...section]]`. That is why
 * this is not a set-membership test: it is how the router actually decides.
 */
function serves(routes: Set<string>, path: string): boolean {
  if (routes.has(path)) return true;
  for (const route of routes) {
    if (!route.includes("[[...")) continue;
    const base = route.slice(0, route.indexOf("/[[..."));
    if (path === base || path.startsWith(`${base}/`)) return true;
  }
  return false;
}

const navigate = CLIENT_TOOLS.find((t) => t.name === "navigate");
const destinations =
  ((navigate?.parameters as { properties: { path: { enum?: string[] } } })
    .properties.path.enum ?? []);

describe("where the agents may be sent", () => {
  it("had something to check", () => {
    /* a renamed tool or a moved app directory would make every assertion
       below vacuous — and this family of check has been vacuous before */
    expect(navigate, "the navigate tool is registered").toBeDefined();
    expect(destinations.length).toBeGreaterThan(10);
    expect(realRoutes().size).toBeGreaterThan(20);
  });

  it("every destination the model is offered is a page the app serves", () => {
    const routes = realRoutes();
    const missing = destinations.filter((path) => !serves(routes, path));
    expect(missing, "offered to the model, served by nothing").toEqual([]);
  });

  it("every destination survives the browser's own allow-list", () => {
    /* the executor refuses anything NAVIGABLE rejects, so a route in the enum
       and not in the regex is a tool that answers "that route is not
       navigable" — a refusal about the product's own page */
    const refused = destinations.filter((path) => !NAVIGABLE.test(path));
    expect(refused, "in the enum, refused by the executor").toEqual([]);
  });

  it("every page a person can reach from the shell is a place the model can be sent (the reverse)", () => {
    /*
     * The enum ⊆ routes direction was asserted from the start; this is the
     * other one, added 2026-09-06 when `/projects` and `/chat` — both pages
     * for a year of directives — were missing while the platform map told
     * every agent "open any of them (navigate)". The model then sent people
     * to the nearest word it had, which is the 2026-09-04 /echo shape again.
     * Top-level pages only, minus the ones that are honestly not destinations,
     * each with its reason.
     */
    const NOT_DESTINATIONS: Record<string, string> = {
      "/calls": "a legacy list that redirects into meetings — a destination that bounces is a tool that half-works",
      "/capture": "redirects to the recorder inside meetings",
      "/skills": "redirects into Management",
      "/connectors": "redirects into Management",
      "/admin": "redirects into Management",
      "/platform": "the vendor console — root only, never a place to send a member",
      "/help": "the help is a document, opened from the rail; the model answers questions itself",
      "/sign-in": "auth", "/sign-up": "auth", "/forgot": "auth", "/reset": "auth",
      "/pending": "auth state", "/suspended": "auth state",
      "/onboarding": "the first-time flow (M54) — walked once, in order, by the person alone; an agent sending somebody back into it would be undoing their arrival",
    };
    const topLevel = [...realRoutes()]
      .filter((route) => route !== "/" && !route.includes("[") && route.split("/").length === 2);
    const unreachable = topLevel.filter((route) => !destinations.includes(route) && !NOT_DESTINATIONS[route]);
    expect(unreachable, "pages the app serves that the model cannot send anyone to").toEqual([]);
    /* the allow-list must name real pages, or a deleted page reads as covered */
    const stale = Object.keys(NOT_DESTINATIONS).filter((route) => !serves(realRoutes(), route));
    expect(stale, "allow-list entries naming no page").toEqual([]);
  });

  it("the product's own places are REACHABLE — the half a regex cannot ask", () => {
    /*
     * The other direction, and the one the report was about. Nothing was
     * broken about /echo; what was broken is that meetings, tasks and
     * integrations existed and the agents had never been told. A check that
     * only asks "is every listed route real" passes forever on a map that
     * lists three routes.
     */
    for (const place of ["/meetings", "/tasks", "/agents", "/integrations", "/assistant"]) {
      expect(destinations, `${place} is somewhere an agent should be able to go`)
        .toContain(place);
    }
  });

  it("the control: a route the app does not serve is detected", () => {
    /* proves `serves` can answer NO — without this the first assertion passes
       against a matcher that returns true for everything, which is exactly
       how a route map comes to be checked by something that cannot fail */
    const routes = realRoutes();
    expect(serves(routes, "/meetings")).toBe(true);
    /* a catch-all's own sub-path, which a naive exact-match would miss —
       `/echo/speakers` stood here until that surface was deleted */
    expect(serves(routes, "/settings/security")).toBe(true);
    expect(serves(routes, "/definitely-not-a-page")).toBe(false);
  });

  /*
   * THE DIRECTION THIS FILE DID NOT LOOK (review F19).
   *
   * The three-way containment above is *enum ⊆ NAVIGABLE ⊆ route tree*, and
   * it passed for months while `NAVIGABLE` admitted seven `/echo/*` addresses
   * that no longer resolved. `NAVIGABLE` is a SUPERSET of the enum, so
   * nothing above ever reads the parts of it the enum does not name — and
   * `projects` and `chat` were added to that very regex while the dead branch
   * sat two alternations away.
   *
   * A regex cannot be enumerated in general. This one is a flat alternation of
   * literals by construction, and that is a property worth pinning: if it ever
   * stops being one, this test says so rather than quietly checking nothing.
   */
  describe("NAVIGABLE itself, not only the enum inside it", () => {
    /** the literal top-level segments the pattern admits */
    const admitted = (): string[] => {
      const src = NAVIGABLE.source;
      const open = src.indexOf("(");
      const close = src.lastIndexOf(")");
      expect(open, "NAVIGABLE is still one alternation group").toBeGreaterThan(-1);
      return src
        .slice(open + 1, close)
        .split("|")
        .map((branch) => branch.replace(/\(.*$/, "").replace(/[?^$\\]/g, "").trim())
        .filter(Boolean)
        .map((segment) => `/${segment}`);
    };

    it("parses to a list of real segments, or says it cannot", () => {
      /* the vacuum guard: if the shape changes and this yields nothing, every
         assertion below passes over an empty array */
      expect(admitted().length, "segments parsed out of NAVIGABLE").toBeGreaterThan(8);
      expect(admitted()).toContain("/meetings");
      /*
       * AND THE PARSE ITSELF HAS TO BE HONEST. A nested alternation —
       * `echo(\/(record|upload))?` — splits on `|` into fragments this simple
       * reader cannot name, and it would then report `/upload))` as a dead
       * route: a real failure with a nonsense address, which sends the reader
       * to look for a page rather than at this parser. "I cannot read the
       * pattern" and "the pattern admits a dead page" are different nothings.
       */
      const unparsed = admitted().filter((seg) => !/^\/[a-z-]*$/.test(seg));
      expect(unparsed, "NAVIGABLE is no longer a flat alternation this test can read").toEqual([]);
    });

    it("every address NAVIGABLE admits is a page the app serves", () => {
      const routes = realRoutes();
      const dead = admitted().filter((path) => !serves(routes, path));
      expect(dead, "the executor would navigate here and the app serves nothing").toEqual([]);
    });
  });

  /*
   * EVERY `surface.push`, not only the `navigate` tool's.
   *
   * `start_recording` pushed a hardcoded `/echo/record?agentStart=…` from a
   * different `case` arm and returned `{ ok: true }` while doing it. The guard
   * above is scoped to the navigate enum, so it has a hole exactly where a
   * navigation escapes that tool — the same shape as a BFF checker scoped to
   * `coreFetch` missing the raw `fetch` family (review F10).
   */
  it("every literal path pushed onto the surface resolves", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "agentSurface.ts"), "utf8");
    const pushes = [...source.matchAll(/surface\.push\(\s*[`"']([^`"'$]*)/g)]
      .map((m) => m[1] ?? "")
      .filter((p) => p.startsWith("/"))
      /* a template's leading literal is enough: `/meetings/${id}` yields
         `/meetings/`, whose base is what has to exist */
      .map((p) => p.replace(/\/$/, ""))
      .map((p) => p.split("?")[0] ?? "")
      .filter(Boolean);
    expect(pushes.length, "surface.push sites found — a rename would empty this").toBeGreaterThan(3);
    const routes = realRoutes();
    const dead = [...new Set(pushes)].filter((p) => !serves(routes, p));
    expect(dead, "pushed by a client tool, served by nothing").toEqual([]);
  });
});
