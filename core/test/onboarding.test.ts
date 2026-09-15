import { beforeEach, describe, expect, it } from "vitest";

import { createMembersRepo } from "../src/api/members.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

/**
 * The first-time flow's save (db/0223, M54), at the statement:
 *
 *  · answers MERGE — the statement appends with `||`, never replaces, so a
 *    step that sends only its own keys cannot erase an earlier step's;
 *  · the stamp lands ONCE — `coalesce(onboarding_completed_at, now())`, so a
 *    second completion keeps the first time;
 *  · a deployment without the column is refused BY NAME (`not_migrated`),
 *    never let through to a 42703 the api can only call "unexpected";
 *  · the answers are bounded (a jsonb with no bound is a place a client can
 *    write anything at all);
 *  · `/v1/me` serves the stamp, the answers and the workspace's kind when the
 *    columns exist — and omits them, rather than defaulting them, when not.
 *
 * The fake answers the catalogue probe explicitly: `present` decides whether
 * `information_schema.columns` returns a row, which is the one seam the
 * capability layer reads.
 */
const ALICE = "11111111-1111-4111-8111-111111111111";
const identity = { userId: ALICE, orgId: "0a000000-0000-4000-8000-00000000000a", role: "owner" as const, isActive: true };

function fakeDb(present: boolean) {
  const log: { sql: string; params: unknown[] }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params: params ?? [] });
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        if (sql.includes("information_schema.columns")) return present ? [{ present: 1 }] : [];
        if (sql.includes("from echo.app_user u") && sql.includes("left join echo.org o")) {
          return [{
            id: ALICE, email: "alice@example.com", display_name: "آلیس", display_name_en: null,
            username: null, avatar_url: null, role: "owner", status: "active",
            accepted_at: new Date("2026-09-15T00:00:00Z"), last_seen_at: null,
            created_at: new Date("2026-09-15T00:00:00Z"), preferred_model: null,
            locale: "fa", calendar: "auto", timezone: "auto", org_name: "آلیس",
            ...(present
              ? { onboarding: { goals: ["meetings"] }, onboarding_completed_at: null, org_kind: "personal" }
              : {}),
          }];
        }
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

beforeEach(() => resetCapabilityCache());

describe("updateOnboarding", () => {
  it("MERGES the answers and leaves the stamp alone when `complete` is not sent", async () => {
    const { db, log } = fakeDb(true);
    await createMembersRepo(db).updateOnboarding(identity, { answers: { goals: ["meetings"], step: "work" } });
    const write = log.find((l) => l.sql.includes("update echo.app_user"));
    expect(write, "the answers reached a statement").toBeDefined();
    expect(write!.sql).toMatch(/set onboarding = onboarding \|\| \$2::text::jsonb/);
    expect(write!.sql).toMatch(/coalesce\(onboarding_completed_at, now\(\)\)/);
    expect(write!.params).toEqual([ALICE, JSON.stringify({ goals: ["meetings"], step: "work" }), false]);
  });

  it("stamps the end when asked — and the statement keeps an earlier stamp", async () => {
    const { db, log } = fakeDb(true);
    await createMembersRepo(db).updateOnboarding(identity, { complete: true });
    const write = log.find((l) => l.sql.includes("update echo.app_user"));
    expect(write!.params).toEqual([ALICE, "{}", true]);
    /* the ONCE is in the SQL, not in the caller: `coalesce(existing, now())`
       is what a second completion runs into */
    expect(write!.sql).toMatch(/when \$3::boolean then coalesce\(onboarding_completed_at, now\(\)\)/);
  });

  it("writes nothing for an empty patch, and reads the person back", async () => {
    const { db, log } = fakeDb(true);
    const me = await createMembersRepo(db).updateOnboarding(identity, {});
    expect(log.some((l) => l.sql.includes("update echo.app_user"))).toBe(false);
    expect(me.org_kind).toBe("personal");
  });

  it("refuses by name on a deployment without the column, before any statement runs", async () => {
    const { db, log } = fakeDb(false);
    await expect(createMembersRepo(db).updateOnboarding(identity, { answers: { goals: [] } }))
      .rejects.toMatchObject({ code: "not_migrated" });
    expect(log.some((l) => l.sql.includes("update echo.app_user"))).toBe(false);
  });

  it("bounds the answers — forty keys, eight kilobytes", async () => {
    const { db } = fakeDb(true);
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]));
    await expect(createMembersRepo(db).updateOnboarding(identity, { answers: many }))
      .rejects.toMatchObject({ code: "answers_too_many" });
    await expect(createMembersRepo(db).updateOnboarding(identity, { answers: { big: "x".repeat(9000) } }))
      .rejects.toMatchObject({ code: "answers_too_large" });
  });
});

describe("/v1/me carries the flow's state and the workspace's kind", () => {
  it("serves the three fields when the columns exist", async () => {
    const { db } = fakeDb(true);
    const me = await createMembersRepo(db).me(identity);
    expect(me.onboarding).toEqual({ goals: ["meetings"] });
    expect(me.onboarding_completed_at).toBeNull();
    expect(me.org_kind).toBe("personal");
  });

  it("OMITS them — never defaults them — on a deployment without the migration", async () => {
    const { db } = fakeDb(false);
    const me = await createMembersRepo(db).me(identity);
    expect("onboarding_completed_at" in me).toBe(false);
    expect("onboarding" in me).toBe(false);
    expect("org_kind" in me).toBe(false);
  });
});
