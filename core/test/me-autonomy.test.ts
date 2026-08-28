import { describe, expect, it } from "vitest";

import { createMembersRepo } from "../src/api/members.ts";
import { actorAutonomy, resetCapabilityCache } from "../src/db/capabilities.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * [REVISED 2026-08-28, user directive] "remove watch and act from everywhere
 * in the platform. the only thing that must be in the platform is assist."
 *
 * The M36 dial left the product: `actorAutonomy` is PINNED to "assist"
 * (PINNED_AUTONOMY, src/db/capabilities.ts) and /v1/me serves the pin, never
 * the stored value. The columns and the wire field deliberately STAY, which
 * is why the load-bearing fixture here is a row that stores "act": the fakes
 * are written so an UN-pinned resolution would read act back — delete the
 * early return in `actorAutonomy` and the pinned tests below go red
 * (verified red that way before this file was trusted).
 *
 * The pre-directive concern — "stored and never served" (the locale
 * precedent) — is retired with the dial; the absence case is kept because
 * capability gating still governs whether the FIELD rides the wire at all:
 * an un-migrated deployment must not name the column in its select.
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

describe("autonomy is pinned to assist — the dial left the product", () => {
  it("actorAutonomy resolves 'assist' over a stored 'act' — the pin site itself", async () => {
    resetCapabilityCache();
    // a fake an UN-pinned resolver would believe: column present, row at act
    const { db } = fakeDb((sql) =>
      sql.includes("information_schema.columns")
        ? [{ ok: 1 }]
        : [{ autonomy: "act", ceiling: "act" }]);
    expect(await actorAutonomy(db, ADMIN_ID)).toBe("assist");
    resetCapabilityCache();
  });

  it("actorAutonomy resolves 'assist' over a stored 'watch' — no other rung survives", async () => {
    resetCapabilityCache();
    const { db } = fakeDb((sql) =>
      sql.includes("information_schema.columns")
        ? [{ ok: 1 }]
        : [{ autonomy: "watch", ceiling: "watch" }]);
    expect(await actorAutonomy(db, ADMIN_ID)).toBe("assist");
    resetCapabilityCache();
  });

  it("/v1/me serves the PIN over a stored 'act' — no client renders a stale dial", async () => {
    resetCapabilityCache();
    const { db, log } = fakeDb((sql) =>
      sql.includes("information_schema.columns") ? [{ ok: 1 }] : [meRow]);
    const me = await createMembersRepo(db).me(ADMIN_ID);
    expect(me.autonomy).toBe("assist");
    // the field still rides the wire on a migrated deployment
    expect("autonomy" in me).toBe(true);
    expect(log.find((l) => l.sql.includes("from echo.app_user"))!.sql).toContain("u.autonomy");
    resetCapabilityCache();
  });

  it("OMITS the field before db/0073 — absence is still not an 'assist'", async () => {
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
