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
  owner_id: ALICE, word_timestamps: true,
};

interface DbShape { userStatus?: string; callVisible?: boolean }

function fakeDb({ userStatus = "active", callVisible = true }: DbShape = {}) {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        if (sql.includes("app_user")) {
          return [{ id: ALICE, org_id: "org-a", role: "member", status: userStatus, org_status: "active" }];
        }
        if (sql.includes("insert into echo.agent_run")) return [{ id: RUN }];
        if (sql.includes("echo.call")) return callVisible ? [callRow] : [];
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

  it("closes EVERY product route to a pending account, not just the list", async () => {
    const app = server(fakeDb({ userStatus: "pending" }));
    for (const [method, url] of [
      ["GET", "/v1/calls"], ["GET", `/v1/calls/${CALL}`],
      ["PATCH", `/v1/calls/${CALL}`], ["DELETE", `/v1/calls/${CALL}`],
      ["POST", "/v1/assistant/ask"],
    ] as const) {
      const res = await app.inject({ method, url, headers: authed, payload: { question: "q", title: "t" } });
      expect([403], `${method} ${url}`).toContain(res.statusCode);
    }
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
    expect(res.json().calls[0]).toMatchObject({ id: CALL, wordTimestamps: true, ownerId: ALICE });
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
