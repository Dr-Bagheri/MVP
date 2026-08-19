/** M32's platform control plane: metadata only, named mutations only. */
import { describe, expect, it } from "vitest";

import { createPlatformRepo, isPlatformRoot } from "../src/api/platform.ts";
import { ValidationError } from "../src/api/errors.ts";
import type { Identity } from "../src/agent/types.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";

const ROOT: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-822222222222",
  role: "owner",
  isActive: true,
};
const TARGET = "33333333-3333-4333-8333-333333333333";

function fakeDb(root = true) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (sql.includes("actor_is_platform_root")) return [{ is_platform_root: root }];
        if (sql.includes("organization_total")) return [{
          organization_total: "2", organization_active: "1", organization_suspended: "1",
          user_total: "3", user_active: "2", user_pending: "0", user_disabled: "1", platform_roots: "1",
        }];
        if (sql.includes("group by o.id")) return [
          { id: "org-1", name: "Acme", status: "active", locale: "en", created_at: new Date("2026-08-01"), member_count: "2" },
          { id: "org-2", name: "Beta", status: "suspended", locale: "fa", created_at: new Date("2026-08-02"), member_count: "1" },
        ];
        if (sql.includes("exists (select 1 from echo.platform_operator p where p.user_id = u.id)")) return [{
          id: TARGET, org_id: "org-2", org_name: "Beta", email: "person@example.com",
          display_name: "Person", username: null, role: "member", status: "active",
          created_at: new Date("2026-08-02"), last_seen_at: null, is_platform_root: false,
        }];
        if (sql.includes("echo.platform_audit")) return [{
          id: "7", actor_id: ROOT.userId, actor_email: "root@example.com", action: "org_status_changed",
          target_user_id: null, target_org_id: "org-2", reason: "Billing hold", created_at: new Date("2026-08-03"),
        }];
        if (
          sql.includes("platform_set_") || sql.includes("platform_grant_root") ||
          sql.includes("platform_revoke_root") || sql.includes("platform_update_") ||
          sql.includes("platform_soft_delete_") || sql.includes("platform_restore_")
        ) {
          return [{ changed: true }];
        }
        if (sql.includes("bootstrap_platform_root")) return [{ created: true }];
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

describe("platform-root authority", () => {
  it("is a fresh database fact, not an organization role or JWT field", async () => {
    const yes = fakeDb(true);
    const no = fakeDb(false);
    await expect(isPlatformRoot(yes.db, ROOT)).resolves.toBe(true);
    await expect(isPlatformRoot(no.db, ROOT)).resolves.toBe(false);
  });

  it("returns organization/user metadata and immutable platform audit only", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await expect(repo.overview(ROOT)).resolves.toEqual({
      current_user_id: ROOT.userId,
      organizations: { total: 2, active: 1, suspended: 1 },
      users: { total: 3, active: 2, pending: 0, disabled: 1 },
      platform_roots: 1,
    });
    await expect(repo.organizations(ROOT, { limit: 1 })).resolves.toMatchObject({
      items: [{ id: "org-1", member_count: 2 }], next_offset: 1,
    });
    await expect(repo.users(ROOT)).resolves.toMatchObject({
      items: [{ id: TARGET, email: "person@example.com", is_platform_root: false }],
    });
    await expect(repo.audit(ROOT)).resolves.toMatchObject({
      items: [{ action: "org_status_changed", target_org_id: "org-2" }],
    });

    const sql = log.map((entry) => entry.sql).join("\n");
    // Privacy is a negative property: it is not enough that the listed
    // metadata works. The control plane must never reach a content table.
    expect(sql).not.toMatch(/echo\.(call|call_part|transcript_segment|summary|agent_session|agent_message|connector_secret|connector_connection)/);
  });

  it("uses named database operations for every mutation, never a direct table update", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await repo.setOrganizationStatus(ROOT, TARGET, "suspended", "Billing hold");
    await repo.setUserStatus(ROOT, TARGET, "disabled", "Account security review");
    await repo.grantRoot(ROOT, TARGET, "On-call platform coverage");
    await repo.revokeRoot(ROOT, TARGET, "On-call rotation ended");

    const sql = log.map((entry) => entry.sql).join("\n");
    expect(sql).toContain("echo.platform_set_org_status");
    expect(sql).toContain("echo.platform_set_user_status");
    expect(sql).toContain("echo.platform_grant_root");
    expect(sql).toContain("echo.platform_revoke_root");
    expect(sql).not.toMatch(/update\s+echo\.(org|app_user|platform_operator)/i);
  });

  it("requires a bounded reason before a database mutation is attempted", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await expect(repo.setUserStatus(ROOT, TARGET, "disabled", "x"))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log.filter((entry) => entry.sql.includes("platform_set_user_status"))).toHaveLength(0);
  });

  it("edit + soft-delete/restore also go through named operations, never direct SQL", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await repo.updateOrganization(ROOT, TARGET, "Acme Renamed", "en", "corrected legal name");
    await repo.updateUser(ROOT, TARGET, { display_name: "New Name", role: "admin" }, "role change approved");
    await repo.softDeleteOrganization(ROOT, TARGET, "offboarding the account");
    await repo.restoreOrganization(ROOT, TARGET, "reinstated after review");
    await repo.softDeleteUser(ROOT, TARGET, "account removed on request");
    await repo.restoreUser(ROOT, TARGET, "account reinstated");

    const sql = log.map((entry) => entry.sql).join("\n");
    expect(sql).toContain("echo.platform_update_org");
    expect(sql).toContain("echo.platform_update_user");
    expect(sql).toContain("echo.platform_soft_delete_org");
    expect(sql).toContain("echo.platform_restore_org");
    expect(sql).toContain("echo.platform_soft_delete_user");
    expect(sql).toContain("echo.platform_restore_user");
    // Same negative property as the status mutations: no direct table write.
    expect(sql).not.toMatch(/update\s+echo\.(org|app_user|platform_operator)/i);
  });

  it("rejects an unknown organization role at the edit boundary before any SQL", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await expect(repo.updateUser(ROOT, TARGET, { role: "superuser" }, "a valid enough reason"))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log.filter((entry) => entry.sql.includes("platform_update_user"))).toHaveLength(0);
  });

  it("never sends an email in a user edit — the login identity is auth-owned", async () => {
    const { db, log } = fakeDb();
    const repo = createPlatformRepo(db);
    await repo.updateUser(ROOT, TARGET, { display_name: "New Name" }, "display name correction");
    const call = log.find((entry) => entry.sql.includes("platform_update_user"));
    expect(call).toBeTruthy();
    // actor, target, display_name, display_name_en, username, locale, role, reason — eight, no email.
    expect(call?.params).toHaveLength(8);
    expect(call?.params).not.toContain("person@example.com");
  });
});
