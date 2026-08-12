/**
 * Does every surface SPEC describes actually exist? (rule 13)
 *
 * `/v1/models` and `/v1/admin/members` were in SPEC and simply absent. No
 * test failed, because **a test suite cannot tell you about a route you never
 * wrote** — every other test asks "does this behave correctly", and a missing
 * route has no behaviour to be wrong. It took a frontend session getting 404s
 * and asking whether that meant "not built" or "wrong path".
 *
 * So the SPEC surface list is curated ONCE, here, and asserted against
 * Fastify's actual route tree. Adding a line to this list before writing the
 * route is the intended workflow: it fails, then you build it.
 *
 * The list is deliberately hand-written rather than derived from the server —
 * derived from the server it would assert that the code equals itself, which
 * is the shape of every fixture that has fooled us this week.
 */
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/api/server.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

/**
 * Every route the product is supposed to expose, with the SPEC section or
 * milestone that requires it. A surface that is deliberately NOT built yet
 * belongs in `KNOWN_ABSENT` below, with a reason — not silently missing.
 */
const REQUIRED_ROUTES: [method: string, path: string, why: string][] = [
  ["GET", "/health", "liveness"],

  ["GET", "/v1/calls", "SPEC §Calls — the list"],
  ["GET", "/v1/calls/:id", "SPEC §Calls — one call"],
  ["PATCH", "/v1/calls/:id", "SPEC §Calls — rename / re-scope"],
  ["DELETE", "/v1/calls/:id", "M11 — soft delete"],

  ["GET", "/v1/calls/:id/transcript", "SPEC §The transcript"],
  ["GET", "/v1/calls/:id/summary", "SPEC §The summary"],
  ["GET", "/v1/calls/:id/summaries", "invariant 4 — versions, never edits"],
  ["GET", "/v1/search", "SPEC §Search"],

  ["POST", "/v1/assistant/ask", "SPEC §The assistant"],
  ["GET", "/v1/skills", "SPEC §Skills — the picker"],

  ["GET", "/v1/models", "SPEC §The assistant — 'each user picks their own model'"],
  ["PUT", "/v1/models/preferred", "M5 — the pick is the person's own"],

  ["GET", "/v1/admin/members", "SPEC §Settings & admin — members list"],
  ["POST", "/v1/admin/members/:id/accept", "M15 — the pending-approval queue"],
  ["PATCH", "/v1/admin/members/:id", "SPEC §Settings & admin — role assignment"],

  ["POST", "/v1/gateway/keys", "M17 — per-org API keys"],
  ["GET", "/v1/gateway/keys", "M17"],
  ["DELETE", "/v1/gateway/keys/:id", "M17 — revoke, never delete"],
  ["POST", "/v1/gateway/webhooks", "M17 — webhooks"],
  ["GET", "/v1/gateway/webhooks", "M17"],
  ["PATCH", "/v1/gateway/webhooks/:id", "M17 — disable, never delete"],
  ["GET", "/v1/gateway/deliveries", "M17 — delivery history"],
];

/**
 * Surfaces SPEC implies that are NOT built, each with a reason. This exists so
 * "not built yet" is a recorded decision rather than an oversight — the exact
 * distinction that let /v1/models go missing.
 */
const KNOWN_ABSENT: [what: string, why: string][] = [
  ["GET /v1/admin/models", "org-level model curation: echo.org.allowed_models has no admin endpoint yet; frontend's screen is mock-fed and marked known-stale"],
  ["POST /v1/calls/:id/transcript/correct", "SPEC's three agent WRITE tools are not built; steward to rule whether they land this milestone or next"],
];

function fakeDb() {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async () => []) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return createDb({ app: make(), agent: make() });
}

/**
 * "METHOD /path" for every route Fastify actually has.
 *
 * `printRoutes` renders a NESTED tree, not a flat list:
 *
 *   ├── /v1/calls (GET, HEAD)
 *   │   └── /:id (GET, PATCH, DELETE)
 *   │       ├── /transcript (GET, HEAD)
 *
 * so a line's own text is a fragment and the full path is the concatenation
 * of its ancestors. My first version regexed each line independently and
 * reported eleven routes missing that exist — a fixture bug that would have
 * read as a damning finding. Depth is the indent before the branch marker,
 * four characters per level.
 */
function actualRoutes(): Set<string> {
  const app = buildServer({ db: fakeDb(), jwtSecret: "manifest", tools: [], toolDeps: {} });
  const found = new Set<string>();
  const stack: string[] = [];

  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const match = /^((?:[│ ]\s{3})*)[├└]──\s(\S+)(?:\s\(([^)]+)\))?/.exec(line);
    if (!match) continue;
    const [, indent, fragment, methods] = match as unknown as [string, string, string, string | undefined];
    const depth = indent.length / 4;
    stack.length = depth;
    stack[depth] = fragment;
    if (!methods) continue;   // a branch node with no handler of its own
    const path = stack.slice(0, depth + 1).join("").replace(/\/$/, "") || "/";
    for (const method of methods.split(",")) found.add(`${method.trim()} ${path}`);
  }
  return found;
}

describe("every SPEC surface exists", () => {
  const routes = actualRoutes();

  it("parsed a plausible route tree at all", () => {
    // Guard on the guard: if the parser silently produced nothing, every
    // route below would "pass" a contains-check against an empty haystack in
    // some future rewrite. Assert positively that it found real routes.
    expect(routes.size).toBeGreaterThan(15);
    expect(routes.has("GET /health")).toBe(true);
  });

  it.each(REQUIRED_ROUTES)("%s %s — %s", (method, path) => {
    // Exact set membership, not substring: `GET /v1/calls` must not satisfy a
    // requirement for `GET /v1/calls/:id`.
    expect(routes.has(`${method} ${path}`), `${method} ${path} is missing`).toBe(true);
  });

  it("records surfaces that are deliberately not built", () => {
    // The point is not the assertion, it is that the list exists and has
    // reasons in it. A missing route with a reason is a decision; a missing
    // route without one is what happened to /v1/models.
    for (const [what, why] of KNOWN_ABSENT) {
      expect(why.length, what).toBeGreaterThan(20);
    }
  });
});
