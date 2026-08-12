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
  Type: {},
}));

const { buildServer } = await import("../src/api/server.ts");
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

const SECRET = "test-secret";
const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

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
  callVisible?: boolean; summaryVisible?: boolean;
  keyValid?: boolean; keyAllowsAssistant?: boolean;
}

function fakeDb({
  userStatus = "active", userRole = "member", orgStatus = "active",
  callVisible = true, summaryVisible = true,
  keyValid = true, keyAllowsAssistant = false,
}: DbShape = {}) {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        if (sql.includes("resolve_api_key")) {
          return keyValid ? [{ actor_id: ALICE, allow_assistant: keyAllowsAssistant }] : [];
        }
        if (sql.includes("app_user")) {
          return [{ id: ALICE, org_id: "org-a", role: userRole, status: userStatus, org_status: orgStatus }];
        }
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

describe("auth contract on /v1", () => {
  it("401s with no token", async () => {
    const res = await server().inject({ method: "GET", url: "/v1/calls" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated" });
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

  it("deletes softly and answers 204", async () => {
    const res = await server().inject({
      method: "DELETE", url: `/v1/calls/${CALL}`, headers: authed,
    });
    expect(res.statusCode).toBe(204);
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
    expect(res.json()).toEqual({ error: "unauthenticated" });
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
      method: "POST", url: "/v1/assistant/ask", headers: keyed, payload: { question: "چه شد؟" },
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

  it("400s a missing question before opening a stream", async () => {
    const res = await server().inject({
      method: "POST", url: "/v1/assistant/ask", headers: authed, payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
  });
});
