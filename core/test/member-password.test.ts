/**
 * An admin sets a member's password (db/0137, user directive 2026-08-29).
 *
 * Three properties, and only one of them is "it works":
 *
 *  1. The RANK rule is asked BEFORE the provider is called, so a refused
 *     reset never reaches Supabase at all. Order matters here in a way it
 *     usually does not: the provider call is the irreversible half, and a
 *     door that authorised afterwards would already have changed someone's
 *     password by the time it decided it should not have.
 *
 *  2. The SESSIONS end. Setting a password does not invalidate refresh
 *     tokens, so without this step an admin resetting a compromised account
 *     would do the one thing they believe closes the door, and it would stay
 *     open. This is the assertion most likely to be deleted by someone
 *     tidying, and the one whose absence has no visible symptom.
 *
 *  3. The password reaches the PROVIDER and nothing else. Not the audit
 *     detail, not a log line, not the response.
 */
import { describe, expect, it, vi } from "vitest";

import { createMemberPasswordRepo } from "../src/api/member-password.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};
const TARGET = "33333333-3333-4333-8333-333333333333";

function fakeDb(outranks: boolean, sessionsEnded = 2) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("actor_outranks")) return [{ outranks }];
        if (sql.includes("end_all_member_sessions")) return [{ n: sessionsEnded }];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const CONFIG = { supabaseUrl: "https://project.supabase.co", serviceKey: "service-key" };

describe("setting a member's password", () => {
  it("REFUSES a member the caller does not outrank, before touching the provider", async () => {
    const fetchImpl = vi.fn();
    const { db } = fakeDb(false);
    await expect(
      createMemberPasswordRepo(db, { ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })
        .set(ADMIN, TARGET, "a-long-enough-password"),
    ).rejects.toMatchObject({ code: "outrank_required" });
    /*
     * The load-bearing half of this test. Asserting only the rejection would
     * pass against a door that set the password and THEN refused — which is
     * the same defect with a tidier error message.
     */
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sets it through the admin API, and sends the password to nobody else", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const { db, log } = fakeDb(true, 3);
    const result = await createMemberPasswordRepo(db, {
      ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch,
    }).set(ADMIN, TARGET, "correct-horse-battery");

    expect(result).toEqual({ sessions_ended: 3 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://project.supabase.co/auth/v1/admin/users/${TARGET}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ password: "correct-horse-battery" });

    /*
     * And NOWHERE in the SQL. Every parameter of every statement is checked
     * rather than just the audit insert — the password reaching the database
     * at all is the failure, whichever statement carried it.
     */
    const params = log.flatMap((l) => l.params ?? []);
    expect(params).not.toContain("correct-horse-battery");
    expect(log.map((l) => l.sql).join(" ")).not.toContain("correct-horse-battery");
  });

  it("ENDS their sessions and records the count", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const { db, log } = fakeDb(true, 4);
    await createMemberPasswordRepo(db, {
      ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch,
    }).set(ADMIN, TARGET, "a-long-enough-password");

    expect(log.some((l) => l.sql.includes("end_all_member_sessions"))).toBe(true);
    const audit = log.find((l) => l.sql.includes("insert into echo.admin_action"));
    expect(audit).toBeTruthy();
    expect(audit?.params).toContain("member_password_set");
    /* the count is the part an auditor reads for */
    expect(JSON.stringify(audit?.params)).toContain("\\\"sessions_ended\\\":4");
  });

  it("refuses a short password without asking anyone", async () => {
    const fetchImpl = vi.fn();
    const { db, log } = fakeDb(true);
    await expect(
      createMemberPasswordRepo(db, { ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch })
        .set(ADMIN, TARGET, "short"),
    ).rejects.toMatchObject({ code: "password_too_short" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("says so when the deployment has no service key, rather than reporting success", async () => {
    /*
     * The kinds-of-nothing case. A deployment without the key cannot do this
     * at all, and a silent success would leave an admin believing they had
     * handed someone a working password — the failure would surface as that
     * person being unable to sign in, days later, with no trail.
     */
    const { db } = fakeDb(true);
    await expect(
      createMemberPasswordRepo(db, { supabaseUrl: CONFIG.supabaseUrl }).set(ADMIN, TARGET, "a-long-password"),
    ).rejects.toMatchObject({ code: "password_reset_unconfigured" });
  });
});
