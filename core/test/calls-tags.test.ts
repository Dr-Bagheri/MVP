/**
 * 0086 tags at the api layer: capability-gated both ways. The discriminating
 * cases are the UN-MIGRATED ones — a filter that silently stops filtering
 * and a write that silently drops are the failure modes, so both must
 * REFUSE with not_migrated until the column exists.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createCallsRepo } from "../src/api/calls.ts";
import { ConflictError } from "../src/api/errors.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const CALL = "33333333-3333-4333-8333-333333333333";
const IDENTITY: Identity = { userId: ALICE, orgId: "org-a", role: "member", isActive: true };

const row = (over: Record<string, unknown> = {}) => ({
  id: CALL, title: "جلسه بودجه", scope: "private", status: "ready",
  language: "fa", started_at: "2026-08-12T09:00:00.000Z",
  duration_ms: 1_800_000, owner_id: ALICE,
  source: null, archived_at: null, deleted_at: null,
  purge_after: null, current_summary_id: null,
  transcribed_part_count: 2, timed_part_count: 2, ...over,
});

function fakeDb(opts: { migrated: boolean; rows?: unknown[] }) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const answer = (sql: string) => {
    if (sql.includes("information_schema")) return opts.migrated ? [{ ok: 1 }] : [];
    if (sql.trim().toLowerCase().startsWith("set local")
      || sql.includes("set_config('echo.actor_id'")) return [];
    return opts.rows ?? [row()];
  };
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return answer(sql) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

const product = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.filter((l) => {
    const sql = l.sql.trim().toLowerCase();
    return !sql.startsWith("set local")
      && !sql.includes("set_config('echo.actor_id'")
      && !sql.includes("information_schema");
  });

beforeEach(() => resetCapabilityCache());

describe("tags, migrated", () => {
  it("the list filter rides the array-contains operator with the tag as a parameter", async () => {
    const { db, log } = fakeDb({ migrated: true });
    await createCallsRepo(db).list(IDENTITY, { tag: "client-x" });
    const q = product(log)[0]!;
    expect(q.sql).toContain("c.tags @> array[$3::text]");
    expect(q.params?.[2]).toBe("client-x");
  });

  it("update replaces the WHOLE set, trimmed and deduped", async () => {
    const { db, log } = fakeDb({ migrated: true, rows: [{ id: CALL }, row({ tags: ["a"] })] });
    await createCallsRepo(db).update(IDENTITY, CALL, { tags: [" پروژه ", "b", "b", ""] });
    const q = product(log).find((l) => l.sql.includes("update echo.call"))!;
    expect(q.sql).toContain("tags = $4::text[]");
    expect(q.params?.[3]).toEqual(["پروژه", "b"]);
  });

  it("a row carrying tags publishes them; a tagless wire stays ABSENT, never []", async () => {
    const { db } = fakeDb({ migrated: true, rows: [row({ tags: ["x"] })] });
    const [withTags] = await createCallsRepo(db).list(IDENTITY);
    expect(withTags?.tags).toEqual(["x"]);

    resetCapabilityCache();
    const bare = fakeDb({ migrated: false });
    const [without] = await createCallsRepo(bare.db).list(IDENTITY);
    expect(without && "tags" in without).toBe(false);
  });
});

describe("tags, NOT migrated — both doors refuse rather than lie", () => {
  it("the filter refuses instead of returning everything", async () => {
    const { db } = fakeDb({ migrated: false });
    await expect(createCallsRepo(db).list(IDENTITY, { tag: "x" }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it("the write refuses instead of dropping the tags silently", async () => {
    const { db } = fakeDb({ migrated: false });
    await expect(createCallsRepo(db).update(IDENTITY, CALL, { tags: ["x"] }))
      .rejects.toBeInstanceOf(ConflictError);
  });
});
