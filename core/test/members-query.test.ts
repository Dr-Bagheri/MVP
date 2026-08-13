/**
 * The UM table's search / filter / sort (M24).
 *
 * The interesting failures here are not "does it filter" — they are the ways
 * a directory filter quietly lies: a sort key that reaches SQL as a column
 * name, a search that covers one of two name columns, a `%` in someone's
 * search string matching everything, and NULLs sorting to the top of "most
 * recently active".
 */
import { describe, expect, it } from "vitest";

import { ValidationError } from "../src/api/errors.ts";
import { createMembersRepo } from "../src/api/members.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};

function fakeDb() {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const listQuery = (log: { sql: string; params?: unknown[] | undefined }[]) =>
  log.find((l) => l.sql.includes("from echo.app_user"))!;

describe("sort is a closed set, never a column name", () => {
  it("rejects an unknown sort and names the choices", async () => {
    const { db } = fakeDb();
    const failure = await createMembersRepo(db).list(IDENTITY, { sort: "created_at" })
      .catch((error: unknown) => error);
    // `created_at` is a real COLUMN and deliberately not a valid sort KEY:
    // accepting it would make the schema's names an API contract, so renaming
    // a column would break callers who guessed one.
    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as Error).message).toContain("last_seen");
  });

  it("maps a sort KEY to SQL rather than passing the caller's text through", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { sort: "name" });
    const sql = listQuery(log).sql;
    // The key is `name`; the SQL is `display_name`. They differ on purpose —
    // that gap is the proof the value was mapped and not interpolated.
    expect(sql).toContain("order by display_name");
    expect(sql).not.toContain("order by name");
  });

  it("puts never-seen members LAST when sorting by last activity", async () => {
    // Postgres sorts NULLs first on DESC. Someone who has never signed in is
    // not the most recent thing that happened, and a UM table that opens with
    // them at the top reads as sorted-by-nothing.
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { sort: "last_seen" });
    expect(listQuery(log).sql).toContain("last_seen_at desc nulls last");
  });

  it("keeps the pending queue on top by default", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY);
    expect(listQuery(log).sql).toContain("(status = 'pending') desc");
  });
});

describe("search covers everything a person is findable by", () => {
  it("matches both name columns, the username and the email", async () => {
    // An org with Persian and Latin names would otherwise have half its
    // people unsearchable depending on which script the admin typed — which
    // reads as "search is broken", not "search covers one column".
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { search: "ali" });
    const sql = listQuery(log).sql;
    for (const column of ["display_name", "display_name_en", "username", "email"]) {
      expect(sql).toContain(column);
    }
  });

  it("escapes LIKE wildcards in the caller's text", async () => {
    // Unescaped, a search for "%" matches every row and a search for "_"
    // matches any single character — the filter silently stops filtering.
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { search: "50%_off" });
    expect(listQuery(log).params?.[0]).toBe("%50\\%\\_off%");
  });

  it("treats a whitespace-only search as no search", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { search: "   " });
    expect(listQuery(log).params?.[0]).toBeNull();
  });
});

describe("the stat tiles never fake a delta (M24)", () => {
  function statsDb(history: Record<string, unknown>[], firstRecorded: unknown) {
    const log: { sql: string; params?: unknown[] | undefined }[] = [];
    const make = (): SqlClient => ({
      async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        const tx = (async () => []) as unknown as SqlTx;
        (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
          log.push({ sql, params });
          if (sql.includes("min(changed_at)")) return [{ first_recorded: firstRecorded }];
          if (sql.includes("user_status_history")) return history;
          if (sql.includes("app_user")) return [{ pending: 1, active: 3, disabled: 0, total: 4 }];
          return [];
        }) as SqlTx["unsafe"];
        return fn(tx);
      },
      async end() {},
    });
    return { db: createDb({ app: make(), agent: make() }), log };
  }

  it("reports history_since as null when nothing was ever recorded", async () => {
    // The distinction the whole response exists for: null means "we were not
    // recording", zero means "nothing changed". A tile that renders "+0 this
    // month" over an empty log is a fabricated delta arrived at honestly.
    const { db } = statsDb([{ activated: 0, disabled: 0, joined: 0 }], null);
    const stats = await createMembersRepo(db).stats(IDENTITY);
    expect(stats.trend.history_since).toBeNull();
    expect(stats.trend.activated).toBe(0);
  });

  it("reports a real start once the log has rows", async () => {
    const { db } = statsDb(
      [{ activated: 2, disabled: 1, joined: 3 }],
      new Date("2026-08-13T00:00:00Z"),
    );
    const stats = await createMembersRepo(db).stats(IDENTITY);
    expect(stats.trend.history_since).toBe("2026-08-13T00:00:00.000Z");
    expect(stats.trend.activated).toBe(2);
  });

  it("takes counts from app_user, not from replaying the log", async () => {
    // "How many are pending" is a current-state question. Deriving it from
    // history would drift the moment a row was written by anything else.
    const { db, log } = statsDb([{ activated: 0, disabled: 0, joined: 0 }], null);
    const stats = await createMembersRepo(db).stats(IDENTITY);
    expect(stats.counts).toEqual({ pending: 1, active: 3, disabled: 0, total: 4 });
    expect(log.some((l) => l.sql.includes("from echo.app_user"))).toBe(true);
  });

  it("does not window the were-we-recording query", async () => {
    // It answers a different question from "what happened recently", and
    // windowing it would make an old, quiet log look like no log at all.
    const { db, log } = statsDb([{ activated: 0, disabled: 0, joined: 0 }], null);
    await createMembersRepo(db).stats(IDENTITY, { windowDays: 7 });
    const recording = log.find((l) => l.sql.includes("min(changed_at)"))!;
    expect(recording.sql).not.toContain("make_interval");
  });

  it("rejects an absurd window rather than scanning forever", async () => {
    const { db } = statsDb([], null);
    await expect(createMembersRepo(db).stats(IDENTITY, { windowDays: 4000 }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("filters are validated against the published vocabularies", () => {
  it("rejects a status outside echo.user_status", async () => {
    const { db } = fakeDb();
    await expect(createMembersRepo(db).list(IDENTITY, { status: "banned" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a role outside echo.member_role", async () => {
    const { db } = fakeDb();
    await expect(createMembersRepo(db).list(IDENTITY, { role: "superuser" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts owner — the role that did not exist this morning", async () => {
    // Validated against MEMBER_ROLES rather than a literal union, so M23's
    // third role became filterable the moment the vocabulary adopted it.
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY, { role: "owner" });
    expect(listQuery(log).params?.[2]).toBe("owner");
  });

  it("passes no filters as SQL nulls, not as absent predicates", async () => {
    const { db, log } = fakeDb();
    await createMembersRepo(db).list(IDENTITY);
    expect(listQuery(log).params).toEqual([null, null, null]);
  });
});
