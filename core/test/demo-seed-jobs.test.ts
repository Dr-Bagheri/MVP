/**
 * The seed JOB ledger and its routes (M52, 2026-09-09).
 *
 * Two rules here can only be proved by their negative:
 *
 *  - READ ONCE. A create's result carries the presenter's password. The
 *    test that matters is not "the first read returns it" — a ledger that
 *    never forgot anything passes that — it is that the SECOND read returns
 *    nothing. Verified red by removing the delete from `read`.
 *
 *  - ONE SEED PER NAME. The 409 is asserted while the first job is still
 *    running, on a `run` the test holds open, so the assertion cannot pass
 *    because the first seed happened to finish first.
 *
 * The route half runs Fastify's real router with a fake database and an auth
 * service pointed at a port nothing listens on: the POST answers 202 before
 * the seed does anything, the seed fails in the background where it must,
 * and the poll delivers that failure once. A validation refusal stays a 400
 * and never becomes a job — the input is parsed BEFORE the ledger is asked.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeKey, signES256, startJwksServer } from "./helpers/es256.ts";
import { createSeedJobs } from "../src/api/demo-seed/jobs.ts";
import { ConflictError } from "../src/api/errors.ts";
import { buildServer } from "../src/api/server.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

const ROOT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A `run` the test finishes by hand. */
function heldRun<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { run: () => promise, resolve, reject };
}

/** Let the ledger's `.then` handlers run after a `run` settles. */
const settle = () => new Promise<void>((res) => setTimeout(res, 0));

describe("the seed job ledger", () => {
  let at = new Date("2026-09-09T08:00:00.000Z");
  const clock = () => at;
  let ids = 0;
  const jobs = () => createSeedJobs({
    now: clock, ttlMs: 10 * 60 * 1000, max: 3, newId: () => `job-${++ids}`,
  });

  beforeEach(() => {
    at = new Date("2026-09-09T08:00:00.000Z");
    ids = 0;
  });

  it("answers at once, then reports the stage the seed is on", async () => {
    const ledger = jobs();
    const held = heldRun<{ ok: true }>();
    let report: ((stage: string) => void) | undefined;
    const started = ledger.start({
      kind: "create", name: "Demo", ownerId: ROOT,
      stages: ["identities", "organization", "people"],
      run: (progress) => { report = progress; return held.run(); },
    });
    expect(started).toEqual({
      job_id: "job-1",
      stages: ["identities", "organization", "people"],
      started_at: "2026-09-09T08:00:00.000Z",
    });

    await settle();
    expect(report).toBeDefined();
    report!("identities");
    let view = ledger.read("job-1", ROOT);
    expect(view).toMatchObject({ status: "running", stage: "identities", done_stages: 0, total_stages: 3 });

    report!("people");
    view = ledger.read("job-1", ROOT);
    expect(view).toMatchObject({ status: "running", stage: "people", done_stages: 2 });
    /* a running job is NOT consumed by a read */
    expect(ledger.read("job-1", ROOT)).not.toBeNull();
    held.resolve({ ok: true });
  });

  it("delivers a finished result exactly once", async () => {
    const ledger = jobs();
    const held = heldRun<{ owner: { password: string } }>();
    ledger.start({ kind: "create", name: "Demo", ownerId: ROOT, stages: ["a"], run: held.run });
    held.resolve({ owner: { password: "Xk4-mQ7pRt2vNb5YwZ9c" } });
    await settle();

    const first = ledger.read("job-1", ROOT);
    expect(first).toMatchObject({ status: "done", done_stages: 1, total_stages: 1, stage: null });
    expect((first!.result as { owner: { password: string } }).owner.password).toBe("Xk4-mQ7pRt2vNb5YwZ9c");
    /* THE RULE: the password left the process with that response */
    expect(ledger.read("job-1", ROOT)).toBeNull();
    expect(ledger.size).toBe(0);
  });

  it("delivers a failure once, with its code, and never a result beside it", async () => {
    const ledger = jobs();
    const held = heldRun<never>();
    ledger.start({ kind: "reseed", name: "Demo", ownerId: ROOT, stages: ["a", "b"], run: held.run });
    held.reject(new ConflictError("the door refused", { code: "demo_create_failed" }));
    await settle();

    const view = ledger.read("job-1", ROOT);
    expect(view).toMatchObject({
      status: "failed", error: { message: "the door refused", code: "demo_create_failed" },
    });
    expect("result" in view!).toBe(false);
    expect(ledger.read("job-1", ROOT)).toBeNull();
  });

  it("refuses a second seed for a name that is still running — and only while it runs", async () => {
    const ledger = jobs();
    const held = heldRun<null>();
    ledger.start({ kind: "create", name: "Pishro Demo", ownerId: ROOT, stages: ["a"], run: held.run });

    /* trimmed and case-folded, the way the door's uniqueness reads a name */
    expect(() => ledger.start({
      kind: "create", name: "  pishro demo ", ownerId: ROOT, stages: ["a"], run: () => Promise.resolve(null),
    })).toThrow(/a seed for this name is already running/);
    expect(ledger.isRunning("Pishro Demo")).toBe(true);
    /* a DIFFERENT name is not blocked by it */
    expect(() => ledger.start({
      kind: "create", name: "Northstar", ownerId: ROOT, stages: ["a"], run: () => Promise.resolve(null),
    })).not.toThrow();

    held.resolve(null);
    await settle();
    /* the control: once it has finished, the same name may be seeded again */
    expect(ledger.isRunning("Pishro Demo")).toBe(false);
    expect(() => ledger.start({
      kind: "create", name: "Pishro Demo", ownerId: ROOT, stages: ["a"], run: () => Promise.resolve(null),
    })).not.toThrow();
  });

  it("forgets a finished job nobody read after ten minutes, and keeps one read just before", async () => {
    const ledger = jobs();
    const a = heldRun<null>();
    const b = heldRun<null>();
    ledger.start({ kind: "create", name: "A", ownerId: ROOT, stages: ["a"], run: a.run });
    ledger.start({ kind: "create", name: "B", ownerId: ROOT, stages: ["a"], run: b.run });
    a.resolve(null);
    b.resolve(null);
    await settle();

    at = new Date(at.getTime() + 10 * 60 * 1000 - 1);
    expect(ledger.read("job-1", ROOT)).toMatchObject({ status: "done" });
    at = new Date(at.getTime() + 1);
    /* job-2 sat unread for the whole window: unknown now, not "done" */
    expect(ledger.read("job-2", ROOT)).toBeNull();
    expect(ledger.size).toBe(0);
  });

  it("keeps a running job alive past the window — only FINISHED jobs expire", async () => {
    const ledger = jobs();
    const held = heldRun<null>();
    ledger.start({ kind: "create", name: "A", ownerId: ROOT, stages: ["a"], run: held.run });
    at = new Date(at.getTime() + 60 * 60 * 1000);
    expect(ledger.read("job-1", ROOT)).toMatchObject({ status: "running" });
    held.resolve(null);
  });

  it("shows another root's job as unknown", async () => {
    const ledger = jobs();
    const held = heldRun<null>();
    ledger.start({ kind: "create", name: "A", ownerId: ROOT, stages: ["a"], run: held.run });
    expect(ledger.read("job-1", OTHER)).toBeNull();
    /* and the miss did not consume it for its owner */
    expect(ledger.read("job-1", ROOT)).not.toBeNull();
    held.resolve(null);
  });

  it("stays bounded: finished entries make room, running ones are never dropped", async () => {
    const ledger = jobs(); // max 3
    const done = heldRun<null>();
    ledger.start({ kind: "create", name: "Done", ownerId: ROOT, stages: ["a"], run: done.run });
    done.resolve(null);
    await settle();
    const r1 = heldRun<null>();
    const r2 = heldRun<null>();
    ledger.start({ kind: "create", name: "R1", ownerId: ROOT, stages: ["a"], run: r1.run });
    ledger.start({ kind: "create", name: "R2", ownerId: ROOT, stages: ["a"], run: r2.run });
    expect(ledger.size).toBe(3);

    /* a fourth start evicts the finished one, never a running one */
    const r3 = heldRun<null>();
    ledger.start({ kind: "create", name: "R3", ownerId: ROOT, stages: ["a"], run: r3.run });
    expect(ledger.size).toBe(3);
    expect(ledger.read("job-1", ROOT)).toBeNull();
    expect(ledger.read("job-2", ROOT)).toMatchObject({ status: "running" });

    /* full of running seeds: refused by name, nothing dropped */
    expect(() => ledger.start({
      kind: "create", name: "R4", ownerId: ROOT, stages: ["a"], run: () => Promise.resolve(null),
    })).toThrow(/too many demo seeds/);
    expect(ledger.size).toBe(3);
    r1.resolve(null); r2.resolve(null); r3.resolve(null);
  });

  it("records a `run` that throws before its first await as a failed job", async () => {
    const ledger = jobs();
    ledger.start({
      kind: "create", name: "Boom", ownerId: ROOT, stages: ["a"],
      run: () => { throw new Error("sync boom"); },
    });
    await settle();
    expect(ledger.read("job-1", ROOT)).toMatchObject({ status: "failed", error: { message: "sync boom" } });
  });
});

// ── the routes ─────────────────────────────────────────────────────────────

const KEY = makeKey("jobs-key");
const jwks = await startJwksServer([KEY]);
afterAll(() => jwks.close());

function fakeDb(platformRoot: boolean) {
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        if (sql.includes("actor_is_platform_root")) return [{ is_platform_root: platformRoot }];
        if (sql.includes("app_user")) {
          return [{ id: ROOT, org_id: "org-a", role: "owner", status: "active", org_status: "active" }];
        }
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return createDb({ app: make(), agent: make() });
}

const authed = {
  authorization: `Bearer ${signES256(KEY, { sub: ROOT, exp: Math.floor(Date.now() / 1000) + 3600 })}`,
  "content-type": "application/json",
};

const input = {
  name: "Route Test Demo", language: "en", demo_date: "2026-09-09",
  offset_minutes: 20, reason: "a test of the job route",
};

async function serverWithAuth(platformRoot = true) {
  /* an auth service on a port nothing listens on: the seed's FIRST act is
     to mint an identity there, so it fails at once and mints nothing */
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "not-a-real-key");
  const app = buildServer({ db: fakeDb(platformRoot), jwksUrl: jwks.url, tools: [], toolDeps: {} });
  return app;
}

describe("the seed job routes", () => {
  it("answers a create with 202 and a job, before the seed has done anything", async () => {
    const app = await serverWithAuth();
    const res = await app.inject({
      method: "POST", url: "/v1/platform/demo-orgs", headers: authed, payload: input,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { job_id: string; stages: string[]; started_at: string };
    expect(typeof body.job_id).toBe("string");
    expect(body.stages.slice(0, 3)).toEqual(["identities", "organization", "people"]);
    expect(body.stages.at(-1)).toBe("glossary");
    expect(Number.isNaN(Date.parse(body.started_at))).toBe(false);
    /* and NOTHING of a result rides on the 202 */
    expect("owner" in body).toBe(false);

    /* the poll: it finishes (failing, at the auth service) and is delivered once */
    let view: { status: string; error?: { message: string } } | undefined;
    for (let i = 0; i < 200; i++) {
      const poll = await app.inject({ method: "GET", url: `/v1/platform/demo-orgs/jobs/${body.job_id}`, headers: authed });
      expect(poll.statusCode).toBe(200);
      view = poll.json();
      if (view!.status !== "running") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(view!.status).toBe("failed");
    expect(view!.error!.message).toMatch(/the demo organization was not created/);

    const again = await app.inject({ method: "GET", url: `/v1/platform/demo-orgs/jobs/${body.job_id}`, headers: authed });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it("keeps a refused input a 400 — it never becomes a job", async () => {
    const app = await serverWithAuth();
    const res = await app.inject({
      method: "POST", url: "/v1/platform/demo-orgs", headers: authed,
      payload: { ...input, language: "de" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/en or fa/);
    await app.close();
  });

  it("answers 404 for a job it does not know", async () => {
    const app = await serverWithAuth();
    const res = await app.inject({
      method: "GET", url: "/v1/platform/demo-orgs/jobs/00000000-0000-4000-8000-000000000000", headers: authed,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("is root-walled like the rest of the demo tab", async () => {
    const app = await serverWithAuth(false);
    const res = await app.inject({
      method: "GET", url: "/v1/platform/demo-orgs/jobs/00000000-0000-4000-8000-000000000000", headers: authed,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
