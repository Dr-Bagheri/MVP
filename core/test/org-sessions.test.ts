/**
 * The org sessions surface (db/0135, user directive 2026-08-29).
 *
 * The WALL is the database's — three definer doors, walked against the live
 * catalogue as owner, admin, plain member and an outsider before any of this
 * was written, with everything rolled back. What these tests hold is the
 * layer above it: that the API asks the right question, of the right door,
 * and that the members list does not ask a question a member may not ask.
 *
 * The property worth naming, because it is what makes the feature honest:
 * reading is org-wide and ending is rank-bound, so `can_end` genuinely
 * differs per row. Measured on the live database — the owner sees 17
 * sessions and can end 17; an admin sees the same 17 and can end 16, the
 * owner's own being the one they cannot. A client re-deriving that rule in
 * TypeScript would eventually disagree with the database in front of a user,
 * which is why the door returns the answer rather than the ingredients.
 */
import { describe, expect, it } from "vitest";

import { createMembersRepo } from "../src/api/members.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};
const OWNER: Identity = { ...ADMIN, role: "owner" };
const MEMBER: Identity = { ...ADMIN, role: "member" };

/** producer-shaped: what echo.app_user returns, joined or not. */
const ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "someone@example.test",
  display_name: "کسی",
  display_name_en: null,
  username: null,
  avatar_url: null,
  role: "member",
  status: "active",
  accepted_at: new Date("2026-08-01T00:00:00Z"),
  last_seen_at: null,
  created_at: new Date("2026-08-01T00:00:00Z"),
};

function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }) .unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

/** the members query, ignoring the identity preamble statements */
const listSql = (log: { sql: string }[]) =>
  log.find((l) => l.sql.includes("from echo.app_user"))?.sql ?? "";

describe("the members list asks for presence only when it may", () => {
  it("joins org_session_presence for an ADMIN", async () => {
    const { db, log } = fakeDb(() => [{ ...ROW, signed_in: true }]);
    const rows = await createMembersRepo(db).list(ADMIN);
    expect(listSql(log)).toContain("echo.org_session_presence()");
    expect(rows[0]?.signed_in).toBe(true);
  });

  it("joins org_session_presence for an OWNER — M23's rank is not just 'admin'", async () => {
    const { db, log } = fakeDb(() => [{ ...ROW, signed_in: false }]);
    const rows = await createMembersRepo(db).list(OWNER);
    expect(listSql(log)).toContain("echo.org_session_presence()");
    expect(rows[0]?.signed_in).toBe(false);
  });

  it("does NOT ask for a MEMBER — the door raises rather than answering empty", async () => {
    /*
     * The control, and the half that matters. `org_session_presence()`
     * refuses a non-admin with 42501 instead of returning no rows, because
     * an empty set would render as "nobody in this org is signed in" — a
     * claim about the organisation built from a fact about permissions. So
     * the query must not contain the join at all.
     */
    const { db, log } = fakeDb(() => [ROW]);
    const rows = await createMembersRepo(db).list(MEMBER);
    expect(listSql(log)).not.toContain("org_session_presence");
    expect(rows[0]?.signed_in).toBeNull();
  });

  it("reports NULL, never false, when the column is absent", async () => {
    /*
     * Three states on one field: signed in, not signed in, and not asked.
     * A row with no `signed_in` column must arrive as null — collapsing it
     * to false would tell a member's screen that every colleague is signed
     * out, which is the same wrong answer the join's absence exists to
     * avoid.
     */
    const { db } = fakeDb(() => [ROW]); // no signed_in key at all
    const rows = await createMembersRepo(db).list(MEMBER);
    expect(rows[0]?.signed_in).toBeNull();
    expect(rows[0]?.signed_in).not.toBe(false);
  });
});
