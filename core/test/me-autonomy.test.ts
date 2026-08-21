import { describe, expect, it } from "vitest";

import { createMembersRepo } from "../src/api/members.ts";
import { resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * /v1/me serves the M36 dial (db/0073) — capability-gated.
 *
 * The locale precedent, pre-empted: a column written by PUT /v1/me/autonomy
 * and read only inside the ask path is "stored and never served" the moment
 * a Settings form wants to SHOW it. Both directions asserted: present-and-
 * served, and absent-and-OMITTED (an un-migrated deployment must not invent
 * an "assist" the row cannot hold — absence and default are different facts).
 */

const ADMIN = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID: Identity = { userId: ADMIN, orgId: "org-a", role: "admin", isActive: true };

function fakeDb(rowsFor: (sql: string, params?: unknown[]) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

const meRow = {
  id: ADMIN, email: "owner@example.com", display_name: "مالک", display_name_en: null,
  username: null, avatar_url: null, role: "owner", status: "active",
  accepted_at: null, last_seen_at: null, created_at: "2026-08-21T09:00:00.000Z",
  preferred_model: null, locale: "fa", calendar: "auto", timezone: "auto",
  org_name: "neurai", autonomy: "act",
};

describe("/v1/me and the autonomy dial", () => {
  it("serves the STORED dial when db/0073 is present", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb((sql) =>
      sql.includes("information_schema.columns") ? [{ ok: 1 }] : [meRow]);
    const me = await createMembersRepo(db).me(ADMIN_ID);
    expect(me.autonomy).toBe("act");
    expect(log.find((l) => l.sql.includes("from echo.app_user"))!.sql).toContain("u.autonomy");
  });

  it("OMITS the dial before db/0073 — absence is not an 'assist'", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb((sql) =>
      sql.includes("information_schema.columns") ? [] : [meRow]);
    const me = await createMembersRepo(db).me(ADMIN_ID);
    expect("autonomy" in me).toBe(false);
    // and the select must not NAME a column the deployment does not have
    expect(log.find((l) => l.sql.includes("from echo.app_user"))!.sql).not.toContain("u.autonomy");
    resetCapabilityCache();
  });
});
