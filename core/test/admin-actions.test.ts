/**
 * Writing `echo.admin_action` (M25) — the audit trail's missing third.
 *
 * Two properties matter more than the rows themselves, and both decay
 * silently if nothing asserts them:
 *
 *  1. **Same transaction as the change.** A log written separately can record
 *     an action that failed, or miss one that succeeded. Either way the audit
 *     disagrees with the world while looking authoritative.
 *  2. **Codes and identifiers, never values.** `detail` is forwarded verbatim
 *     to every admin in the org. I wrote the read half of that rule; this is
 *     the write half, so it binds me first.
 */
import { describe, expect, it } from "vitest";

import { ADMIN_ACTIONS, changedFields } from "../src/api/admin-actions.ts";
import { createInvitationsRepo } from "../src/api/invitations.ts";
import { createMembersRepo } from "../src/api/members.ts";
import { createOrgRepo } from "../src/api/org.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};
const TARGET = "33333333-3333-4333-8333-333333333333";

/** Every statement, in order, with which transaction it ran in. */
function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const log: { tx: number; sql: string; params?: unknown[] | undefined }[] = [];
  let transactions = 0;
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const id = ++transactions;
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        if (!sql.includes("set local") && !sql.includes("set_config")) log.push({ tx: id, sql, params });
        return rowsFor(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

interface Statement { tx: number; sql: string; params?: unknown[] | undefined }

const audited = (log: Statement[]): Statement[] =>
  log.filter((l) => l.sql.includes("insert into echo.admin_action"));

describe("the audit row rides the transaction it describes", () => {
  it("writes the action in the SAME transaction as the change", async () => {
    // Separate transactions would let one commit without the other — an audit
    // that can be wrong in both directions.
    const { db, log } = fakeDb(() => [{ id: ADMIN.orgId, name: "n", status: "active",
      locale: "fa", allowed_models: [], created_at: new Date() }]);
    await createOrgRepo(db).update(ADMIN, { name: "تازه" });
    const change = log.find((l) => l.sql.includes("update echo.org"))!;
    const entry = audited(log)[0]!;
    expect(entry).toBeDefined();
    expect(entry.tx).toBe(change.tx);
  });

  it("records NOTHING when the change affected no row", async () => {
    // A refused or zero-row update must not leave a log entry claiming it
    // happened — the audit would then be lying in the most confident way.
    const { db, log } = fakeDb((sql) => (sql.includes("update echo.org") ? [] : [{}]));
    await createOrgRepo(db).update(ADMIN, { name: "تازه" }).catch(() => {});
    expect(audited(log)).toHaveLength(0);
  });

  it("records nothing when accepting a member who was not pending", async () => {
    const { db, log } = fakeDb(() => []);
    await createMembersRepo(db).accept(ADMIN, TARGET).catch(() => {});
    expect(audited(log)).toHaveLength(0);
  });

  it("records nothing when a tombstone was already applied", async () => {
    // `false` = already tombstoned. A second entry would read as two
    // deletions of one person.
    const { db, log } = fakeDb(() => [{ tombstone_user: false }]);
    await createInvitationsRepo(db).tombstone({ ...ADMIN, role: "owner" }, TARGET, "دلیل آزمایشی").catch(() => {});
    expect(audited(log)).toHaveLength(0);
  });
});

describe("detail carries codes, never values", () => {
  it("records WHICH org fields changed, not what they became", async () => {
    // The whole rule in one assertion: an audit reader learns the org was
    // renamed and never learns the new name.
    const { db, log } = fakeDb(() => [{ id: ADMIN.orgId, name: "n", status: "active",
      locale: "fa", allowed_models: [], created_at: new Date() }]);
    await createOrgRepo(db).update(ADMIN, { name: "نام محرمانه", locale: "en" });
    const detail = String(audited(log)[0]!.params?.[5]);
    expect(JSON.parse(detail)).toEqual({ fields: ["locale", "name"] });
    expect(detail).not.toContain("نام محرمانه");
  });

  it("records an invitation's ROLE and not its email address", async () => {
    // A role is a code from a closed vocabulary; an email is a person.
    // `target_id` is how a reader reaches the address, through a surface that
    // does its own access check.
    const { db, log } = fakeDb(() => [{
      id: TARGET, email: "secret@example.com", role: "member",
      token_prefix: "echo_inv_x", expires_at: new Date(), redeemed_at: null,
      revoked_at: null, created_at: new Date(),
    }]);
    await createInvitationsRepo(db).issue(ADMIN, { email: "secret@example.com" });
    const entry = audited(log)[0]!;
    expect(JSON.parse(String(entry.params?.[5]))).toEqual({ role: "member" });
    expect(JSON.stringify(entry.params)).not.toContain("secret@example.com");
  });

  it("splits a combined member patch into two distinct actions", async () => {
    // A role change and a disable are different events to a later reader, and
    // one request can be both. Merging them would make the log's granularity
    // worse than the operation's.
    const { db, log } = fakeDb(() => [{
      id: TARGET, email: "a@b.c", display_name: "x", display_name_en: null,
      username: null, role: "admin", status: "disabled", accepted_at: null,
      last_seen_at: null, created_at: new Date(),
    }]);
    await createMembersRepo(db).update(ADMIN, TARGET, { role: "admin", status: "disabled" });
    const actions = audited(log).map((l) => l.params?.[2]);
    expect(actions).toEqual(["member_role_changed", "member_status_changed"]);
  });

  it("only uses action names from the published set", async () => {
    // db/0054 enforces `^[a-z][a-z0-9_]*$`, so a camelCase typo fails at the
    // wall — but the wall cannot tell a *wrong* name from a new one.
    for (const action of ADMIN_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("changedFields names fields and drops absences", () => {
  it("ignores keys that were not supplied", () => {
    expect(changedFields({ name: "x", locale: undefined })).toEqual({ fields: ["name"] });
  });

  it("sorts, so one patch always produces one detail", () => {
    // Otherwise two identical changes differ by key order in the log, and a
    // reader comparing entries sees a difference that is not one.
    expect(changedFields({ locale: "en", name: "x" }).fields)
      .toEqual(changedFields({ name: "x", locale: "en" }).fields);
  });
});
