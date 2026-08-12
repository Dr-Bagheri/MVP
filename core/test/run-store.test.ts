/**
 * The shared AgentRunStore: identity discipline on every write, steps
 * appended as they happen (so a crashed run still shows what it did), and
 * the atomic jsonb append rather than read-modify-write.
 */
import { describe, expect, it } from "vitest";

import { createAgentRunStore, getAgentRun } from "../src/agent/run-store.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

function fakeDb(rowsFor: (sql: string) => unknown[] = () => []) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

const step = (seq: number, outcome: "ok" | "denied") => ({
  seq, tool: "read_call", args: { call_id: "c1" }, outcome,
  ms: 5, startedAt: "2026-08-12T00:00:00.000Z",
});

describe("agent run store — identity on every write", () => {
  it("creates the run with the actor set, and returns its id", async () => {
    const { db, log } = fakeDb((sql) => (sql.includes("insert into echo.agent_run") ? [{ id: RUN }] : []));
    const store = createAgentRunStore({ db, identity: IDENTITY });

    const id = await store.begin({
      orgId: "org-a", actorId: ALICE, callId: null, skillId: null,
      kind: "assistant", model: "google/gemini-3.6-flash",
      request: { systemPrompt: "p", input: "q", tools: ["read_call"], skill: null },
    });

    expect(id).toBe(RUN);
    // SET LOCAL precedes the insert, in the same transaction
    expect(log[0]!.sql).toBe(`set local echo.actor_id = '${ALICE}'`);
    expect(log[1]!.sql).toContain("insert into echo.agent_run");
    // the request is stored as jsonb for replay
    expect(String(log[1]!.params?.[6])).toContain("read_call");
  });

  it("fails loudly when RLS returns no row rather than inventing an id", async () => {
    const { db } = fakeDb(() => []); // insert visible to nobody
    const store = createAgentRunStore({ db, identity: IDENTITY });
    await expect(store.begin({
      orgId: "org-b", actorId: ALICE, callId: null, skillId: null,
      kind: "assistant", model: "m", request: {},
    })).rejects.toThrow(/no row/);
  });

  it("appends each step atomically as it happens", async () => {
    const { db, log } = fakeDb(() => []);
    const store = createAgentRunStore({ db, identity: IDENTITY });

    await store.appendStep(RUN, step(0, "ok"));
    await store.appendStep(RUN, step(1, "denied"));

    const appends = log.filter((l) => l.sql.includes("update echo.agent_run"));
    expect(appends).toHaveLength(2);
    // jsonb || jsonb — atomic append, not read-modify-write
    expect(appends[0]!.sql).toContain("steps = steps || $2::jsonb");
    // each append carries exactly one step, wrapped as an array
    expect(JSON.parse(String(appends[0]!.params?.[1]))).toEqual([step(0, "ok")]);
    expect(JSON.parse(String(appends[1]!.params?.[1]))[0].outcome).toBe("denied");
    // and every write set the actor first
    expect(log.filter((l) => l.sql.startsWith("set local")).length).toBe(2);
  });

  it("finishes a run with status, tokens and error", async () => {
    const { db, log } = fakeDb(() => []);
    const store = createAgentRunStore({ db, identity: IDENTITY });

    await store.finish(RUN, { status: "failed", tokensIn: 10, tokensOut: 0, error: "provider down" });

    const update = log.find((l) => l.sql.includes("finished_at = now()"))!;
    expect(update.params).toEqual([RUN, "failed", 10, 0, "provider down"]);
  });

  it("normalises absent tokens to null rather than undefined", async () => {
    const { db, log } = fakeDb(() => []);
    const store = createAgentRunStore({ db, identity: IDENTITY });
    await store.finish(RUN, { status: "succeeded" });
    const update = log.find((l) => l.sql.includes("finished_at = now()"))!;
    expect(update.params).toEqual([RUN, "succeeded", null, null, null]);
  });
});

describe("agent run read side (replay surface)", () => {
  it("maps a row into the record shape", async () => {
    const { db } = fakeDb((sql) => (sql.includes("select id, org_id") ? [{
      id: RUN, org_id: "org-a", actor_id: ALICE, call_id: null, skill_id: null,
      kind: "summarizer", status: "succeeded", model: "m",
      request: { input: "q" }, steps: [step(0, "ok")],
      tokens_in: 10, tokens_out: 5, error: null,
    }] : []));

    const run = await getAgentRun(db, IDENTITY, RUN);
    expect(run?.kind).toBe("summarizer");
    expect(run?.steps).toHaveLength(1);
    expect(run?.tokensIn).toBe(10);
  });

  it("returns undefined for a run the caller cannot see", async () => {
    const { db } = fakeDb(() => []); // RLS hides it
    expect(await getAgentRun(db, IDENTITY, RUN)).toBeUndefined();
  });
});
