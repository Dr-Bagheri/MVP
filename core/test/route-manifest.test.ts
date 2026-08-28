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

  ["GET", "/v1/me", "M1 — the browser never sees the token, so the shell cannot self-identify"],
  ["PATCH", "/v1/me", "M24 round 1 — the caller edits their own names (display_name, display_name_en, username)"],
  ["PATCH", "/v1/me/assistant", "db/0112 — the person's standing assistant voice (Settings·Assistant)"],
  ["GET", "/v1/me/sessions", "db/0112 — the caller's own devices (Security 43)"],
  ["DELETE", "/v1/me/voiceprint", "db/0112 — consent withdrawal is self-service (Security 59)"],
  ["POST", "/v1/signup", "M15 — the only caller of echo.register_account(); without it a signed-up person 401s forever and never reaches the pending queue"],

  ["GET", "/v1/calls", "SPEC §Calls — the list"],
  ["GET", "/v1/calls/:id", "SPEC §Calls — one call"],
  ["PATCH", "/v1/calls/:id", "SPEC §Calls — rename / re-scope"],
  ["DELETE", "/v1/calls/:id", "M11 — soft delete"],
  ["POST", "/v1/calls/:id/archive", "SPEC §Calls — file away without deleting"],
  ["POST", "/v1/calls/:id/unarchive", "SPEC §Calls — the archive filter implies its inverse"],
  ["POST", "/v1/calls/:id/restore", "M11 — db/0011 names restore as a non-owner-permitted act"],

  ["GET", "/v1/calls/:id/transcript", "SPEC §The transcript"],
  ["GET", "/v1/calls/:id/speakers", "SPEC §The transcript — resolving a segment's speaker_id"],
  ["GET", "/v1/calls/:id/summary", "SPEC §The summary"],
  ["GET", "/v1/calls/:id/summaries", "invariant 4 — versions, never edits"],
  ["POST", "/v1/calls/:id/summaries", "2026-08-23 — regenerate as a NEW version, optionally shaped by a ruled template and the requester's instruction"],
  ["GET", "/v1/search", "SPEC §Search"],

  ["POST", "/v1/assistant/ask", "SPEC §The assistant"],

  ["POST", "/v1/workflows/:ref/run", "M41 P1 — the manual trigger; without it the engine has no door"],
  ["GET", "/v1/workflows/engine", "M41 — the runnable catalogue; the Run button's honest source"],
  ["GET", "/v1/workflows/runs", "M41 P1 — the run ledger's list"],
  ["GET", "/v1/workflows/runs/:id", "M41 P1 — one run + its steps; where proposals get decided in P3 (W14)"],
  ["POST", "/v1/workflows/runs/:id/decide", "M41 P3/W14 — the decision, on the run, by its owner"],
  ["POST", "/v1/workflows/:ref/signal", "M41 P4 — the inbound-fact trigger"],
  ["POST", "/v1/workflows/:ref/schedule", "M41 P4 — a standing cadence, running as its owner"],
  ["GET", "/v1/workflows/manage", "M41 P5 — the builder's list"],
  ["POST", "/v1/workflows/manage", "M41 P5 — a draft workflow, no SQL"],
  ["GET", "/v1/workflows/manage/:id/graph", "M41 P5 — the editor loads the current program"],
  ["GET", "/v1/workflows/manage/:id/versions", "M41 P5/W32 — the immutable history, for rollback"],
  ["PUT", "/v1/workflows/manage/:id/publish", "M41 P5 — validate-then-insert version N+1"],
  ["PATCH", "/v1/workflows/manage/:id", "M41 P5/W32 — pause, rename, trigger, rollback"],
  ["GET", "/v1/mail/drafts", "M43 - the replies the assistant wrote and nobody has sent"],
  ["GET", "/v1/mail/drafts/:id/source", "M43 - the message a draft answers, read from the provider on demand"],
  ["POST", "/v1/mail/drafts/:id/send", "M43 - the only outward action: a person presses send"],
  ["POST", "/v1/mail/drafts/:id/discard", "M43 - a draft the person does not want"],
  ["POST", "/v1/workflows/starters", "M41 P5 - the shipped starters: the engine is never an empty shelf"],
  ["GET", "/v1/workflows/starters", "2026-08-28 user directive - the library: every shipped starter readable by any member, so /workflows can list what an admin may install"],
  ["GET", "/v1/workflows/auto-apply", "M41 W13 — members may KNOW what auto-applies"],
  ["PUT", "/v1/workflows/auto-apply", "M41 W13/W17 — the standing human decision, admin-only"],
  ["POST", "/v1/assistant/proposals/:id/confirm", "M4 — an inferred write is proposed, then approved"],
  ["POST", "/v1/assistant/proposals/:id/reject", "M4 — a refusal is recorded, not discarded"],
  ["GET", "/v1/assistant/sessions", "M4/db-0018 — conversations persist; the hub needs a list to resume from"],
  ["GET", "/v1/assistant/sessions/:id/messages", "M4 — resume is a read of what was said, never a replay"],
  ["POST", "/v1/assistant/sessions/:id/archive", "Q5 — conversations are archived, never deleted"],
  ["POST", "/v1/assistant/sessions/:id/unarchive", "the archive filter implies its inverse"],
  ["GET", "/v1/skills", "SPEC §Skills — the picker"],

  ["GET", "/v1/models", "SPEC §The assistant — 'each user picks their own model'"],
  ["PUT", "/v1/models/preferred", "M5 — the pick is the person's own"],

  ["GET", "/v1/org", "M25 — Settings·General: the org profile, readable by any active member"],
  ["PATCH", "/v1/admin/org", "M25 — Settings·General is admin-gated for writes"],
  ["GET", "/v1/admin/audit", "M25 — Settings·COMPLIANCE: admin_action + proposal_decision + agent_run as one feed"],
  ["GET", "/v1/admin/server", "M25 — the Management surface: queue depths, retry pressure, keys, storage"],
  ["GET", "/v1/admin/invitations", "M24 — the outstanding invites an admin issued"],
  ["POST", "/v1/admin/invitations", "M24/D25 — invite as the second door; token shown once"],
  ["POST", "/v1/admin/invitations/:id/revoke", "M24 — terms are immutable, so re-invite is revoke-and-reissue"],
  ["POST", "/v1/invitations/redeem", "D8's fifth door — token AND address; a forwarded link is not a bearer token"],
  ["DELETE", "/v1/admin/members/:id", "M24 — true delete via echo.tombstone_user, owner-only (M23 irreversible)"],
  ["GET", "/v1/admin/members", "SPEC §Settings & admin — members list"],
  ["GET", "/v1/admin/members/stats", "M24 — the UM stat tiles; trends from user_status_history, never faked from created_at"],
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
  ["GET /v1/admin/org", "deliberate: it would return the same row and columns as GET /v1/org, and a second read of one row is a second thing that can disagree with the first. The admin screen reads /v1/org and writes PATCH /v1/admin/org"],
  // avatar_url LEFT the absent list 2026-08-16 (user directive): the upload
  // path exists — PATCH /v1/me accepts a capped data:image URL — so the
  // condition the old entry set ("it returns alongside an upload design") is
  // met. v1 stores the cropped image in the column rather than behind a
  // storage signer; see members.ts for why that is a value change away from
  // signed URLs, not a schema change.
  // GET /v1/admin/models LEFT the absent list 2026-08-16 (Part 3): the
  // curation read exists — the whole offered catalogue with allow flags,
  // admin-only. The write stays PATCH /v1/admin/org (allowed_models).
  // (SPEC's three write tools landed in milestone 3 — they are TOOLS, not
  // routes, and their approval flow is the two /proposals routes above.)
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
