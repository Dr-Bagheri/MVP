/**
 * The /v1 surface, exercised through Fastify's real router with `inject`
 * (no socket, real routing/serialisation). Asserts the error contract the
 * BFF codes against, and that every product route is closed to a pending
 * account.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const runPiMock = vi.fn();
vi.mock("../src/agent/pi.ts", () => ({
  runPi: (...args: unknown[]) => runPiMock(...args),
  // The ask route now validates an explicit body.model against the catalogue
  // (choose-by-name wall). The barred entry is here ON PURPOSE: the refusal
  // test needs the upstream to contain what the product must refuse.
  catalogue: () => [
    { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", reasoning: true },
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5", reasoning: false },
  ],
  Type: {},
}));

const { buildServer } = await import("../src/api/server.ts");
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import { isAdmin, isOwner } from "../src/agent/types.ts";
import { MEMBER_ROLES } from "../src/api/vocabulary.ts";

const SECRET = "test-secret";
const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION = "55555555-5555-4555-8555-555555555555";

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
function token(sub = ALICE) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${head}.${body}`).digest().toString("base64url");
  return `${head}.${body}.${sig}`;
}

const callRow = {
  id: CALL, title: "جلسه", scope: "private", status: "ready", language: "fa",
  started_at: "2026-08-12T09:00:00.000Z", duration_ms: 1000,
  owner_id: ALICE, transcribed_part_count: 1, timed_part_count: 1,
};

// words in the STORAGE shape the worker writes — see transcripts-repo.test.ts
const segmentRow = {
  id: "seg-1", seq: 0, part_id: "part-1", start_ms: 1_000, end_ms: 2_500,
  call_speaker_id: null, channel: null, text: "بودجه",
  words: [{ w: "بودجه", s: 1_000, e: 1_400 }], edited: false,
};
const summaryRow = {
  id: "sum-1", version: 1, body: "خلاصه", model: "anthropic/claude-opus-5",
  created_at: "2026-08-12T10:00:00.000Z", created_by: ALICE, agent_run_id: null,
};
const searchRow = {
  call_id: CALL, call_title: "جلسه", kind: "transcript",
  start_ms: 1_000, end_ms: 2_000, snippet: "…<mark>بودجه</mark>…",
};

const apiKeyRow = {
  id: "44444444-4444-4444-8444-444444444444", name: "zapier",
  token_prefix: "echo_sk_abc123", actor_id: ALICE, allow_assistant: false,
  last_used_at: null, expires_at: null, revoked_at: null,
  created_at: "2026-08-12T09:00:00.000Z",
};

interface DbShape {
  userStatus?: string; userRole?: string; orgStatus?: string;
  /** M32: result of the database-owned platform-root predicate. */
  platformRoot?: boolean;
  callVisible?: boolean; summaryVisible?: boolean;
  keyValid?: boolean; keyAllowsAssistant?: boolean;
  preferredModel?: string | null;
  /** Make echo.register_account() raise a duplicate-key, as a second signup does. */
  registerFails?: boolean;
  /**
   * No `app_user` row for the token's subject: signed up with Supabase,
   * never registered here. The state the whole recovery flow keys off.
   */
  userMissing?: boolean;
}

function fakeDb({
  userStatus = "active", userRole = "member", orgStatus = "active",
  platformRoot = false,
  callVisible = true, summaryVisible = true,
  keyValid = true, keyAllowsAssistant = false, preferredModel = null,
  registerFails = false, userMissing = false,
}: DbShape = {}) {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      /**
       * `count` on the returned array: postgres.js reports affected rows
       * there, and the soft delete deliberately has no RETURNING clause (it
       * writes a row db/0013 forbids it to read back). A fake that only
       * models returned ROWS cannot represent that statement at all.
       */
      const answer = (rows: unknown[]): never[] =>
        Object.assign([...rows], { count: rows.length || 1 }) as unknown as never[];
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        if (sql.includes("actor_is_platform_root")) {
          return [{ is_platform_root: platformRoot }];
        }
        if (sql.includes("organization_total")) {
          return [{
            current_user_id: ALICE,
            organization_total: "2", organization_active: "1", organization_suspended: "1",
            user_total: "3", user_active: "2", user_pending: "0", user_disabled: "1", platform_roots: "1",
          }];
        }
        if (sql.includes("resolve_api_key")) {
          return keyValid ? [{ actor_id: ALICE, allow_assistant: keyAllowsAssistant }] : [];
        }
        if (sql.includes("preferred_model")) return [{ preferred_model: preferredModel }];
        // db/0032's named deletion operations. `true` = done, `false` =
        // already in that state; a refusal arrives as a raised 42501, which
        // calls.ts turns into 404.
        /**
         * Assistant conversations (db/0018). Ahead of the generic branches:
         * `ask` now opens or resolves a thread BEFORE the stream, so a fake
         * that answered nothing here would turn every assistant test into a
         * 400 — which is exactly what it did until this existed.
         */
        if (sql.includes("agent_session")) {
          return sql.includes("update") ? [] : [{
            id: SESSION, title: "چه خبر", last_message_at: null,
            archived_at: null, created_at: new Date("2026-08-13T00:00:00Z"),
          }];
        }
        if (sql.includes("echo.agent_message")) {
          return [{
            id: "m1", seq: 0, role: "user", content: "…", tool_calls: [],
            agent_run_id: null, created_at: new Date("2026-08-13T00:00:00Z"),
          }];
        }
        if (sql.includes("soft_delete_call")) return [{ deleted: true }];
        if (sql.includes("restore_call")) return [{ restored: true }];
        /**
         * Registration. Ahead of the `app_user` branch on purpose: the
         * function's name does not contain "app_user", but its RESULT is an
         * app_user row, and a fake that answered the membership shape here
         * would let the route "work" without ever calling db/0015's door.
         */
        if (sql.includes("register_account")) {
          if (registerFails) throw Object.assign(new Error("dup"), { code: "23505" });
          // Mirrors db/0056: a FOUNDER is owner of the new org and ACTIVE at
          // birth (email confirmation was the acceptance), with no acceptance
          // stamp (0057). The join-an-existing-org path still produces
          // pending — asserted where it lives, in db's 80_vendor_acceptance.
          return [{
            id: ALICE, org_id: "org-a", email: "new@example.com", display_name: "New Person",
            role: "owner", status: "active", accepted_at: null, last_seen_at: null,
            created_at: new Date().toISOString(),
          }];
        }
        if (sql.includes("app_user")) {
          if (userMissing) return [];   // verified token, no membership row
          return [{ id: ALICE, org_id: "org-a", role: userRole, status: userStatus, org_status: orgStatus }];
        }
        // An UPDATE with no RETURNING reports its result as an affected-row
        // COUNT — the soft delete is the one such statement, because the row
        // it writes is one db/0013 forbids it to read back. Checked before
        // the table branches below, or `update echo.call …` matches the
        // calls branch and returns rows the real statement never asks for.
        if (/^\s*update\s/i.test(sql.trim()) && !/returning/i.test(sql)) return answer([]);
        if (sql.includes("echo.api_key")) return [apiKeyRow];
        if (sql.includes("insert into echo.agent_run")) return [{ id: RUN }];
        // Order matters, in both directions: the search query JOINS echo.call
        // so it must be caught first, and the calls query SUB-SELECTS
        // transcript_segment (the M20 part counts) so it must be caught
        // before the segment branch.
        if (sql.includes("websearch_to_tsquery")) return [searchRow];
        if (sql.includes("echo.call")) return callVisible ? [callRow] : [];
        if (sql.includes("echo.transcript_segment")) return [segmentRow];
        if (sql.includes("from echo.summary")) return summaryVisible ? [summaryRow] : [];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return createDb({ app: make(), agent: make() });
}

const server = (db = fakeDb()) =>
  buildServer({ db, jwtSecret: SECRET, tools: [], toolDeps: {} });

const authed = { authorization: `Bearer ${token()}` };

describe("M32 platform-root routes", () => {
  it("denies an ordinary active member and exposes only metadata to a root", async () => {
    const denied = await server(fakeDb()).inject({
      method: "GET", url: "/v1/platform/overview", headers: authed,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "forbidden", kind: "forbidden" });

    const granted = await server(fakeDb({ platformRoot: true, orgStatus: "suspended" })).inject({
      method: "GET", url: "/v1/platform/overview", headers: authed,
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toEqual({
      current_user_id: ALICE,
      organizations: { total: 2, active: 1, suspended: 1 },
      users: { total: 3, active: 2, pending: 0, disabled: 1 },
      platform_roots: 1,
    });
  });
});

/**
 * Registration (M15).
 *
 * These exist because the route did not, for reasons no test could have
 * caught: `echo.register_account()` was written, documented as the only way
 * an account is created, granted to echo_app — and never called. Everything
 * around it was correct. The chain simply stopped, and a new person's token
 * verified, resolved to no membership, and 401'd forever.
 */
describe("POST /v1/signup", () => {
  /**
   * A Supabase-shaped token: `sub` plus the `email` claim we register with.
   *
   * `null` means OMIT the claim — not `undefined`, which in JavaScript
   * triggers the default parameter instead. My first version of the no-email
   * test passed `undefined` and therefore tested a token that carried an
   * email, asserting nothing while looking thorough.
   */
  function signupToken(sub = ALICE, email: string | null = "new@example.com") {
    const head = b64({ alg: "HS256", typ: "JWT" });
    const claims = { sub, exp: Math.floor(Date.now() / 1000) + 3600 };
    const body = b64(email === null ? claims : { ...claims, email });
    const sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
      .update(`${head}.${body}`).digest().toString("base64url");
    return `${head}.${body}.${sig}`;
  }

  it("a founder's account is ACTIVE at birth and says so (0056)", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: `Bearer ${signupToken()}` },
      payload: { display_name: "New Person", org_name: "Acme" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // active is the contract, not an implementation detail: the client
    // routes a founder straight into the app on it — the confirmed email
    // was the acceptance (M15 as amended). A JOINER still gets pending and
    // the waiting screen; that path is asserted at its producer (db/80).
    expect(body.status).toBe("active");
    expect(body.role).toBe("owner");
    expect(body.org_id).toBe("org-a");
  });

  it("registers the TOKEN's subject, never a body-supplied id", async () => {
    // The whole security of this route. If a body field could name the
    // account, anyone holding any valid token could register an account for
    // someone else's uuid — including one an admin is about to accept.
    const seen: string[] = [];
    const db = fakeDb();
    const original = db.withoutIdentity.bind(db);
    db.withoutIdentity = ((fn: (tx: SqlTx) => Promise<unknown>) =>
      original(async (tx: SqlTx) => {
        const unsafe = tx.unsafe.bind(tx);
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = ((sql: string, params?: unknown[]) => {
          if (sql.includes("register_account")) seen.push(String(params?.[0]));
          return unsafe(sql, params);
        }) as SqlTx["unsafe"];
        return fn(tx);
      })) as typeof db.withoutIdentity;

    const res = await server(db).inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: `Bearer ${signupToken()}` },
      payload: { display_name: "X", org_name: "Acme", id: CALL, user_id: CALL, sub: CALL },
    });
    expect(res.statusCode).toBe(201);
    expect(seen).toEqual([ALICE]);
  });

  it("refuses an api key — a gateway key must not create accounts", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: "Bearer echo_sk_live_deadbeefdeadbeefdeadbeef" },
      payload: { org_name: "Acme" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token with no email claim rather than inventing one", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: `Bearer ${signupToken(ALICE, null)}` },
      payload: { org_name: "Acme" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects org_name AND join_org together instead of silently picking one", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: `Bearer ${signupToken()}` },
      payload: { org_name: "Acme", join_org: CALL },
    });
    expect(res.statusCode).toBe(400);
  });

  /**
   * The state nobody's suite exercised: signed up with Supabase, never
   * registered here. Front-end 1 named it, and it is not hypothetical — with
   * email confirmation switched on, Supabase returns no session at sign-up,
   * so `/v1/signup` is never called. The person confirms, signs in, and holds
   * a perfectly valid token for a subject with no membership.
   *
   * `unknown_actor` is what makes that recoverable: it is how the client
   * learns "authenticated but unregistered" and routes to org-choice instead
   * of treating it as a bad token. So this asserts the KIND, not just the
   * 401 — the status alone would leave the client unable to tell this from a
   * trust-root mismatch, which is the failure the taxonomy exists to end.
   */
  it("tells an unregistered-but-verified caller apart from a bad token", async () => {
    const res = await server(fakeDb({ userMissing: true })).inject({
      method: "GET", url: "/v1/me",
      headers: { authorization: `Bearer ${signupToken()}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated", kind: "unknown_actor" });
  });

  it("answers 409, not 500, when the account already exists", async () => {
    const res = await server(fakeDb({ registerFails: true })).inject({
      method: "POST", url: "/v1/signup",
      headers: { authorization: `Bearer ${signupToken()}` },
      payload: { org_name: "Acme" },
    });
    expect(res.statusCode).toBe(409);
  });
});

/**
 * last_seen_at (M24) — "last active means a human did something".
 *
 * The ruling is one sentence and every part of it is a trap. Stamping in the
 * shared resolver marks people active from 3am worker jobs (Backend 2 caught
 * me proposing that). Stamping on the gateway path marks them active because
 * their integration polls. Failing the request when the stamp fails takes the
 * product down for a cosmetic column.
 */
/**
 * M23's third role, pinned at the gate.
 *
 * `owner` arrived in `echo.member_role` and three independent checks read
 * `role !== "admin"` — the admin route gate, the admin-only tool wall, and
 * the skills `editable` flag. Each would have refused the org's ROOT as
 * insufficiently privileged, and no test could have failed, because every
 * fixture was a member or an admin. The schema-contract enum assertion is
 * what found it; these keep it found.
 */
describe("a chosen-nothing is present-and-null, never omitted (M24)", () => {
  /**
   * `username` is legally NULL — a person who has not chosen a handle — and
   * `last_seen_at` is legally NULL for someone never seen. Both must arrive
   * as the KEY with a null value, not as a missing key.
   *
   * The difference matters at the client: `"username" in member` is how a
   * form decides whether the field is unset versus whether the server simply
   * does not serve it, and an omitted key makes "not chosen yet" and "not
   * implemented" identical. Same rule as `history_since` on the stat tiles
   * and `deleted_at` on a call — this codebase's recurring bug is two kinds
   * of nothing wearing one shape.
   */
  it("serves /v1/me with null handles as explicit nulls", async () => {
    const res = await server().inject({ method: "GET", url: "/v1/me", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const field of ["username", "display_name_en", "last_seen_at", "accepted_at", "preferred_model"]) {
      expect(Object.hasOwn(body, field), `${field} must be present even when null`).toBe(true);
      expect(body[field]).toBeNull();
    }
  });

  it("serves the members list the same way", async () => {
    // admin, because the route is admin-gated — the default fixture identity
    // is a member and would have made this a 403 that looked like a bug.
    const res = await server(fakeDb({ userRole: "admin" })).inject({
      method: "GET", url: "/v1/admin/members", headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const [member] = res.json().members;
    expect(Object.hasOwn(member, "username")).toBe(true);
    expect(member.username).toBeNull();
  });
});

describe("the owner holds admin authority (M23)", () => {
  it("admits an owner to an admin route", async () => {
    const res = await server(fakeDb({ userRole: "owner" })).inject({
      method: "GET", url: "/v1/admin/members", headers: authed,
    });
    expect(res.statusCode).toBe(200);
  });

  it("still refuses a plain member", async () => {
    const res = await server(fakeDb({ userRole: "member" })).inject({
      method: "GET", url: "/v1/admin/members", headers: authed,
    });
    expect(res.statusCode).toBe(403);
  });

  /**
   * The predicate itself, over the WHOLE enum rather than the two roles that
   * happen to have fixtures.
   *
   * I first wrote this as a route test on the skills `editable` flag, and it
   * failed — the fake serves no org-level skill, so the assertion ran against
   * an empty list. It only surfaced because I had asserted the list was
   * non-empty first; without that it would have "passed" while checking
   * nothing, which is the exact fixture-shaped lie this file keeps finding.
   * Asserting the rule where the rule lives is both truer and cheaper.
   */
  it.each(MEMBER_ROLES)("isAdmin/isOwner are exhaustive over %s", (role) => {
    const identity = { role };
    expect(isAdmin(identity)).toBe(role === "admin" || role === "owner");
    expect(isOwner(identity)).toBe(role === "owner");
  });
});

describe("last_seen_at is stamped only for a human", () => {
  // Same shape the M17 block uses; declared here so this describe stands on
  // its own rather than depending on a sibling's scope.
  const keyed = { authorization: "Bearer echo_sk_test-token" };
  const statements = (log: string[]) => log.filter((s) => s.includes("last_seen_at"));

  function spyDb(shape: DbShape = {}) {
    const db = fakeDb(shape);
    const seen: string[] = [];
    const original = db.withIdentity.bind(db);
    db.withIdentity = ((identity: unknown, fn: (tx: SqlTx) => Promise<unknown>, options?: unknown) =>
      original(identity as never, async (tx: SqlTx) => {
        const unsafe = tx.unsafe.bind(tx);
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = ((sql: string, params?: unknown[]) => {
          seen.push(sql);
          return unsafe(sql, params);
        }) as SqlTx["unsafe"];
        return fn(tx);
      }, options as never)) as typeof db.withIdentity;
    return { db, seen };
  }

  it("stamps a browser caller", async () => {
    const { db, seen } = spyDb();
    const res = await server(db).inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(200);
    expect(statements(seen).length).toBe(1);
  });

  it("does NOT stamp a gateway key — a machine acting as you is not you", async () => {
    // The 3am problem in M17's costume: an integration polling every minute
    // would keep its owner looking permanently online, and an admin deciding
    // who to disable would be reading a cron schedule.
    const { db, seen } = spyDb();
    const res = await server(db).inject({ method: "GET", url: "/v1/calls", headers: keyed });
    expect(res.statusCode).toBe(200);
    expect(statements(seen)).toEqual([]);
  });

  it("never fails the request when the stamp fails", async () => {
    const db = fakeDb();
    const original = db.withIdentity.bind(db);
    db.withIdentity = ((identity: unknown, fn: (tx: SqlTx) => Promise<unknown>, options?: unknown) =>
      original(identity as never, async (tx: SqlTx) => {
        const unsafe = tx.unsafe.bind(tx);
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = ((sql: string, params?: unknown[]) => {
          if (sql.includes("last_seen_at")) throw Object.assign(new Error("nope"), { code: "42501" });
          return unsafe(sql, params);
        }) as SqlTx["unsafe"];
        return fn(tx);
      }, options as never)) as typeof db.withIdentity;

    const res = await server(db).inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(200);
  });
});

describe("auth contract on /v1", () => {
  it("401s with no token", async () => {
    const res = await server().inject({ method: "GET", url: "/v1/calls" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated", kind: "no_token" });
  });

  it("401s on a forged token", async () => {
    const forged = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: ALICE })}.badsig`;
    const res = await server().inject({
      method: "GET", url: "/v1/calls", headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a PENDING account with kind:pending, so the UI can show its M15 screen", async () => {
    const res = await server(fakeDb({ userStatus: "pending" }))
      .inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "account is awaiting activation", kind: "pending" });
  });

  it("403s a SUSPENDED org distinctly from a pending account", async () => {
    // Same status code, different kind and different message. "Awaiting
    // activation" would point these users at an org admin who cannot help
    // them — suspension is resolved with the vendor (steward ruling).
    const res = await server(fakeDb({ orgStatus: "suspended" }))
      .inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "organization is suspended", kind: "suspended" });
  });

  it("keeps a disabled individual on the generic refusal", async () => {
    // The steward ruled `suspended`, not a fourth value. Shipping an unruled
    // kind would put a string on the wire that no screen is designed for.
    const res = await server(fakeDb({ userStatus: "disabled" }))
      .inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden", kind: "forbidden" });
  });

  it("keeps an admin-route refusal indistinguishable from a plain refusal", async () => {
    // A member probing an admin route must not learn that the route is an
    // admin route — same body a non-admin gets anywhere else.
    const res = await server().inject({
      method: "GET", url: "/v1/gateway/keys", headers: authed,
    });
    expect(res.json()).toEqual({ error: "forbidden", kind: "forbidden" });
  });

  it("closes EVERY product route to a pending account, not just the list", async () => {
    const app = server(fakeDb({ userStatus: "pending" }));
    for (const [method, url] of [
      ["GET", "/v1/calls"], ["GET", `/v1/calls/${CALL}`],
      ["PATCH", `/v1/calls/${CALL}`], ["DELETE", `/v1/calls/${CALL}`],
      ["GET", `/v1/calls/${CALL}/transcript`], ["GET", `/v1/calls/${CALL}/summary`],
      ["GET", `/v1/calls/${CALL}/summaries`], ["GET", "/v1/search?q=%D8%A8%D9%88%D8%AF%D8%AC%D9%87"],
      ["POST", "/v1/assistant/ask"],
    ] as const) {
      const res = await app.inject({ method, url, headers: authed, payload: { question: "q", title: "t" } });
      expect([403], `${method} ${url}`).toContain(res.statusCode);
    }
  });

  it("answers an unknown route in the SAME error shape as a hidden row", async () => {
    // Fastify's built-in 404 emits {message, error, statusCode} and bypasses
    // setErrorHandler entirely — a third shape for the BFF to special-case,
    // and a routing-layer way to tell "no such route" from "row you may not
    // see". Found by curling a running instance; no test requested a path
    // that doesn't exist.
    const res = await server().inject({ method: "GET", url: "/v1/nope", headers: authed });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found", kind: "not_found" });
  });

  it("health needs no token (liveness, no data)", async () => {
    const res = await server().inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("calls routes", () => {
  it("lists calls in the client shape", async () => {
    const res = await server().inject({ method: "GET", url: "/v1/calls", headers: authed });
    expect(res.statusCode).toBe(200);
    expect(res.json().calls[0]).toMatchObject({ id: CALL, transcript_timing: "full", owner_id: ALICE });
  });

  it("404s an invisible call — not 403 (existence is information)", async () => {
    const res = await server(fakeDb({ callVisible: false }))
      .inject({ method: "GET", url: `/v1/calls/${CALL}`, headers: authed });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found", kind: "not_found" });
  });

  it("400s a bad id or bad body without touching the database", async () => {
    const app = server();
    expect((await app.inject({ method: "GET", url: "/v1/calls?limit=abc", headers: authed })).statusCode).toBe(400);
    expect((await app.inject({
      method: "PATCH", url: `/v1/calls/${CALL}`, headers: authed, payload: { title: 42 },
    })).statusCode).toBe(400);
  });

  it("deletes softly WITH a reason and answers 204 (0085)", async () => {
    const res = await server().inject({
      method: "DELETE", url: `/v1/calls/${CALL}`, headers: authed,
      payload: { reason: "جلسهٔ آزمایشی بود" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("a delete WITHOUT a reason is a 400 — the ledger takes no blanks", async () => {
    const res = await server().inject({
      method: "DELETE", url: `/v1/calls/${CALL}`, headers: authed,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("transcript, summary and search routes", () => {
  it("serves segments under the call", async () => {
    const res = await server().inject({
      method: "GET", url: `/v1/calls/${CALL}/transcript`, headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      call_id: CALL,
      segments: [{
        start_ms: 1_000, text: "بودجه", speaker_id: null, part_id: "part-1",
        // through the real router and serialiser: the wire carries the
        // translated word shape, not the stored one
        words: [{ w: "بودجه", start_ms: 1_000, end_ms: 1_400 }],
      }],
    });
  });

  it("404s the transcript of an invisible call — NOT an empty segment list", async () => {
    // an empty array would assert "this call exists and has no words", which
    // is both false and a way to probe for calls you may not see
    const res = await server(fakeDb({ callVisible: false })).inject({
      method: "GET", url: `/v1/calls/${CALL}/transcript`, headers: authed,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found", kind: "not_found" });
  });

  it("400s a non-numeric window before running a query", async () => {
    const res = await server().inject({
      method: "GET", url: `/v1/calls/${CALL}/transcript?from_ms=abc`, headers: authed,
    });
    expect(res.statusCode).toBe(400);
  });

  it("serves the current summary and the version history", async () => {
    const app = server();
    const current = await app.inject({ method: "GET", url: `/v1/calls/${CALL}/summary`, headers: authed });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ version: 1, body: "خلاصه" });

    const history = await app.inject({ method: "GET", url: `/v1/calls/${CALL}/summaries`, headers: authed });
    expect(history.json().summaries).toHaveLength(1);
  });

  it("404s a call that exists but has not been summarised yet", async () => {
    const res = await server(fakeDb({ summaryVisible: false })).inject({
      method: "GET", url: `/v1/calls/${CALL}/summary`, headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("searches and returns seekable hits", async () => {
    const res = await server().inject({
      method: "GET", url: "/v1/search?q=%D8%A8%D9%88%D8%AF%D8%AC%D9%87", headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits[0]).toMatchObject({ call_id: CALL, kind: "transcript", start_ms: 1_000 });
  });

  it("400s a search with no q at all, and one too short to mean anything", async () => {
    const app = server();
    expect((await app.inject({ method: "GET", url: "/v1/search", headers: authed })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/search?q=%D8%A8", headers: authed })).statusCode).toBe(400);
  });
});

describe("gateway keys reach the SAME wall as a session (M17)", () => {
  const keyed = { authorization: "Bearer echo_sk_test-token" };

  it("authenticates a product route with a key, identically to a JWT", async () => {
    // The point of routing keys through the same identify() is that there is
    // one wall. If this ever needed its own route table, the two would drift
    // until one of them was missing a check.
    const res = await server().inject({ method: "GET", url: "/v1/calls", headers: keyed });
    expect(res.statusCode).toBe(200);
    expect(res.json().calls[0].id).toBe(CALL);
  });

  it("401s an unknown, revoked or expired key with one indistinguishable answer", async () => {
    const res = await server(fakeDb({ keyValid: false }))
      .inject({ method: "GET", url: "/v1/calls", headers: keyed });
    expect(res.statusCode).toBe(401);
    // `bad_key` covers every way a key fails, deliberately. If a future kind
    // ever splits "no such key" from "revoked", this endpoint becomes an
    // oracle for which keys exist — the exact thing apikeys.ts refuses.
    expect(res.json()).toEqual({ error: "unauthenticated", kind: "bad_key" });
  });

  it("inherits the member's pending status — a key is not a way around M15", async () => {
    const res = await server(fakeDb({ userStatus: "pending" }))
      .inject({ method: "GET", url: "/v1/calls", headers: keyed });
    expect(res.statusCode).toBe(403);
    expect(res.json().kind).toBe("pending");
  });

  it("403s the assistant for a key an admin has not opened (db/0022)", async () => {
    // and refuses BEFORE the stream opens — once headers are out the only
    // way to say no is an error event, which is worse to hand an integrator
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: keyed, payload: { question: "چه شد؟" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("allows the assistant for a key an admin opened", async () => {
    runPiMock.mockReset();
    runPiMock.mockImplementation(async (options: { onText?: (d: string) => void }) => {
      options.onText?.("سلام");
      return { text: "سلام", model: "m", tokensIn: 1, tokensOut: 1 };
    });
    const res = await server(fakeDb({ keyAllowsAssistant: true })).inject({
      method: "POST", url: "/v1/assistant/ask", headers: keyed,
      // a model is required now: the caller names one or has saved one
      payload: { question: "چه شد؟", model: "google/gemini-3.6-flash" },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });

  it("still reads normally with a closed key — scope, not throttle", async () => {
    const res = await server().inject({ method: "GET", url: "/v1/calls", headers: keyed });
    expect(res.statusCode).toBe(200);
  });

  it("cannot manage keys when the member it acts as is not an admin", async () => {
    // a key that could mint keys would be a privilege ladder
    const res = await server().inject({
      method: "POST", url: "/v1/gateway/keys", headers: keyed, payload: { name: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("gateway administration routes", () => {
  const adminDb = () => fakeDb({ userRole: "admin" });

  it("returns the token exactly once, on creation", async () => {
    const res = await server(adminDb()).inject({
      method: "POST", url: "/v1/gateway/keys", headers: authed, payload: { name: "zapier" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toMatch(/^echo_sk_/);

    // and never again in a listing
    const list = await server(adminDb()).inject({
      method: "GET", url: "/v1/gateway/keys", headers: authed,
    });
    expect(list.json().keys[0]).not.toHaveProperty("token");
    expect(list.json().keys[0].token_prefix).toBe("echo_sk_abc123");
  });

  it("is closed to a non-admin member", async () => {
    for (const [method, url] of [
      ["GET", "/v1/gateway/keys"], ["POST", "/v1/gateway/keys"],
      ["GET", "/v1/gateway/webhooks"], ["POST", "/v1/gateway/webhooks"],
      ["GET", "/v1/gateway/deliveries"],
    ] as const) {
      const res = await server().inject({
        method, url, headers: authed, payload: { name: "x", url: "https://x.test", events: ["call.created"] },
      });
      expect([403], `${method} ${url}`).toContain(res.statusCode);
    }
  });

  it("400s a webhook with a non-https url before touching the database", async () => {
    const res = await server(adminDb()).inject({
      method: "POST", url: "/v1/gateway/webhooks", headers: authed,
      payload: { url: "http://x.test", events: ["call.created"] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("assistant SSE route", () => {
  it("streams the agreed vocabulary and ends with done", async () => {
    runPiMock.mockReset();
    runPiMock.mockImplementation(async (options: { onText?: (d: string) => void }) => {
      options.onText?.("سلام");
      return { text: "سلام", model: "m", tokensIn: 1, tokensOut: 1 };
    });

    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed,
      payload: { question: "چه شد؟", model: "google/gemini-3.6-flash" },
    });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    // proxies must not buffer an event stream
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.body).toContain("event: text_delta");
    expect(res.body.trimEnd().endsWith("}")).toBe(true);
    const events = res.body.split("\n\n").filter(Boolean);
    expect(events.at(-1)).toContain("event: done");
  });

  it("falls back to the caller's SAVED model when the request names none", async () => {
    // `preferred_model` was written by PUT /v1/models/preferred and read by
    // NOTHING — a person could pick a model, see it saved, and have every
    // conversation ignore it. Found by driving the live loop with a real
    // account instead of a fixture that always passed a model.
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "پاسخ", model: "m", tokensIn: 1, tokensOut: 1 });
    const db = fakeDb({ preferredModel: "google/gemini-3.6-flash" });
    const res = await server(db).inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed, payload: { question: "چه شد؟" },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const call = runPiMock.mock.calls[0]![0] as { model: { id: string } };
    expect(call.model.id).toBe("google/gemini-3.6-flash");
  });

  it("refuses a BARRED model by name, before the stream — from the body OR a stored preference", async () => {
    // M5: never selectable by name, never re-admittable. The wall must not
    // care where the name came from: a legacy preference stored before the
    // exclusion existed is as refused as a typed one.
    for (const payload of [
      { question: "چه شد؟", model: "anthropic/claude-opus-5" },
      { question: "چه شد؟" }, // falls back to the stored preference below
    ]) {
      const db = fakeDb({ preferredModel: "anthropic/claude-opus-5" });
      const res = await server(db).inject({
        method: "POST", url: "/v1/assistant/ask", headers: authed, payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/not available/);
    }
  });

  it("carries every attached call and the web flag onto the run", async () => {
    runPiMock.mockReset();
    runPiMock.mockResolvedValue({ text: "پاسخ", model: "m", tokensIn: 1, tokensOut: 1 });
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed,
      payload: {
        question: "چه شد؟", model: "google/gemini-3.6-flash",
        call_ids: [CALL, RUN], web: true,
      },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const call = runPiMock.mock.calls[0]![0] as { model: { id: string }; systemPrompt: string };
    // web:true → the provider's online variant is what is dispatched
    expect(call.model.id).toBe("google/gemini-3.6-flash:online");
    // BOTH ids reach the prompt — the wire used to truncate to the first
    expect(call.systemPrompt).toContain(CALL);
    expect(call.systemPrompt).toContain(RUN);
  });

  it("400s an oversized or malformed call_ids list before the stream", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed,
      payload: {
        question: "چه شد؟", model: "google/gemini-3.6-flash",
        call_ids: ["a", "b", "c", "d", "e", "f"],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/call_ids/);
  });

  it("400s BEFORE the stream when no model is chosen anywhere", async () => {
    // modelForRun throws deep in the runtime, so without a pre-stream check
    // the caller gets a FAILED RUN for what is really a 400 — an error event
    // on a half-open SSE connection that every client must special-case.
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed, payload: { question: "چه شد؟" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().error).toMatch(/no model selected/);
  });

  it("400s a missing question before opening a stream", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed, payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
  });
});
