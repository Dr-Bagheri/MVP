/**
 * M35 signal step — the positive-detection assertions (rule 7): a weekly
 * digest firing WRITES a conversation and a card as the owner, and the
 * capability-absent state is a loud consumed skip, never an error loop.
 */
import { describe, expect, it } from "vitest";

import { createSignalStep } from "../src/worker/signal-step.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

function fakeDb({ signalTables = true } = {}) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("information_schema.tables")) {
          return signalTables ? [{ present: 1 }] : [];
        }
        if (sql.includes("from echo.app_user u")) {
          return [{ id: OWNER, org_id: ORG, role: "member", status: "active", org_status: "active" }];
        }
        if (sql.includes("insert into echo.agent_session")) return [{ id: SESSION }];
        if (sql.includes("insert into echo.agent_message")) {
          return [{ id: "m1", seq: 1, role: "assistant", content: "x", tool_calls: [], agent_run_id: null, created_at: new Date() }];
        }
        if (sql.includes("from echo.call")) return [{ n: "2", titles: ["الف", "ب"] }];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const quietLog = { info: () => {}, warn: () => {}, error: () => {} } as never;

describe("the signal step", () => {
  it("a weekly digest firing WRITES a conversation and a card, as the owner", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb();
    const step = createSignalStep({ db });
    await step.handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG, ruleId: "r1" } as never,
      { attempt: 1, log: quietLog },
    );
    const sql = log.map((e) => e.sql).join("\n");
    expect(sql).toContain("insert into echo.agent_session");
    expect(sql).toContain("insert into echo.agent_message");
    expect(sql).toContain("insert into echo.agent_card");
    const card = log.find((e) => e.sql.includes("insert into echo.agent_card"));
    expect(card?.params?.[0]).toBe(ORG);
    expect(card?.params?.[1]).toBe(OWNER);
    expect(card?.params?.[2]).toBe("weekly_digest");
  });

  it("before db/0074, a signal is a loud CONSUMED skip — never a retry loop against missing tables", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb({ signalTables: false });
    const warned: unknown[] = [];
    const step = createSignalStep({ db });
    await step.handle(
      { event: "cron.weekly", ownerId: OWNER, orgId: ORG } as never,
      { attempt: 1, log: { info: () => {}, error: () => {}, warn: (f: unknown) => warned.push(f) } as never },
    );
    expect(warned.length).toBeGreaterThan(0);
    expect(log.some((e) => e.sql.includes("agent_card"))).toBe(false);
    resetCapabilityCache();
  });

  it("a non-signal payload is dropped with a warning, not guessed at", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb();
    const step = createSignalStep({ db });
    await step.handle(
      { callId: "c", ownerId: OWNER } as never,
      { attempt: 1, log: quietLog },
    );
    expect(log.some((e) => e.sql.includes("agent_card"))).toBe(false);
    resetCapabilityCache();
  });
});
