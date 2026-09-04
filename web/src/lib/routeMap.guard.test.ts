import { existsSync, readdirSync, statSync } from "node:fs";
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
});
