import { describe, expect, it } from "vitest";

import { createMembersRepo } from "../src/api/members.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

/**
 * Registration tries the INVITATION DOOR first (db/0060): a live invitation
 * for the verified address makes the person an active member with the
 * granted role — `register_account` (the org-choice path) must never run
 * for them. NULL from the door routes to the normal path.
 */

const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const MEMBER_ROW = {
  id: USER_ID,
  org_id: "bbbbbbbb-2222-4222-8222-222222222222",
  email: "invited@example.com",
  display_name: "",
  display_name_en: null,
  username: null,
  avatar_url: null,
  role: "member",
  status: "active",
  locale: "fa",
  created_at: new Date("2026-08-16T00:00:00Z"),
  accepted_at: new Date("2026-08-16T00:00:00Z"),
};

function fakeDb(redeemAnswers: unknown[]) {
  const log: string[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        log.push(sql);
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        if (sql.includes("redeem_invitation_for_email")) return redeemAnswers;
        if (sql.includes("register_account")) return [MEMBER_ROW];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

describe("register tries the invitation door first", () => {
  it("a live invitation makes the arrival — register_account never runs", async () => {
    const { db, log } = fakeDb([MEMBER_ROW]);
    const member = await createMembersRepo(db).register({
      userId: USER_ID, email: "invited@example.com", displayName: "",
    });
    expect(member.status).toBe("active");
    expect(member.org_id).toBe(MEMBER_ROW.org_id);
    expect(log.some((sql) => sql.includes("register_account"))).toBe(false);
  });

  it("no invitation + an ORG NAME routes to register_account — the join path (0082)", async () => {
    const { db, log } = fakeDb([]);
    await createMembersRepo(db).register({
      userId: USER_ID, email: "nobody-invited@example.com", displayName: "کسی",
      orgName: "شرکت الف",
    });
    expect(log.some((sql) => sql.includes("register_account"))).toBe(true);
  });

  it("no invitation and NO org named is a 400 with a name — founding is gone (0082)", async () => {
    const { db, log } = fakeDb([]);
    await expect(
      createMembersRepo(db).register({
        userId: USER_ID, email: "nobody-invited@example.com", displayName: "کسی",
      }),
    ).rejects.toThrow(/organization is required/);
    // and the db was never asked to found anything
    expect(log.some((sql) => sql.includes("register_account"))).toBe(false);
  });
});
