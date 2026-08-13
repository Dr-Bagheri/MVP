/**
 * The org profile (M25, Settings · General).
 *
 * The test worth reading here is the one asserting what this surface REFUSES
 * to write. `echo.org.status` is grantable, policy-permitted, and a one-word
 * addition away from being settable — and an admin who set their own org
 * suspended would lock out every member including themselves, then be unable
 * to reach the endpoint that could undo it. Absence of a feature leaves no
 * trace; a test naming the absence does.
 */
import { describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "../src/api/errors.ts";
import { createOrgRepo } from "../src/api/org.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};

const ROW = {
  id: IDENTITY.orgId,
  name: "سازمان توسعه",
  status: "active",
  locale: "fa",
  allowed_models: ["openai/gpt-4o-mini"],
  created_at: new Date("2026-08-01T00:00:00Z"),
};

function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const log: { sql: string; params?: unknown[] | undefined }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        return rowsFor(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const queries = (log: { sql: string }[]) =>
  log.filter((l) => !l.sql.includes("set local") && !l.sql.includes("set_config"));

describe("reading the org", () => {
  it("returns the profile, with allowed_models defaulting to a list not a null", async () => {
    // Empty means "no curation" — i.e. every model the platform offers —
    // and a null on the wire would invite `allowed_models?.length` checks
    // that read the two cases the same way.
    const { db } = fakeDb(() => [{ ...ROW, allowed_models: null }]);
    const record = await createOrgRepo(db).get(IDENTITY);
    expect(record.allowed_models).toEqual([]);
    expect(record.created_at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is a 404 when the row is gone, not a crash", async () => {
    const { db } = fakeDb(() => []);
    await expect(createOrgRepo(db).get(IDENTITY)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updating the org", () => {
  it("never writes status, even though the grant and the policy allow it", async () => {
    // The whole point of this file. Suspension is what the platform does to
    // an org, not what an org does to itself.
    const { db, log } = fakeDb(() => [ROW]);
    await createOrgRepo(db).update(IDENTITY, { name: "نام تازه" });
    const update = queries(log).find((l) => l.sql.includes("update echo.org"))!;
    expect(update.sql).not.toMatch(/\bstatus\s*=/);
  });

  it("rejects an empty or whitespace-only name", async () => {
    const { db } = fakeDb(() => [ROW]);
    await expect(createOrgRepo(db).update(IDENTITY, { name: "   " }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a locale that is not a language tag", async () => {
    const { db } = fakeDb(() => [ROW]);
    await expect(createOrgRepo(db).update(IDENTITY, { locale: "Persian" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts the two the product actually uses, and a regional tag", async () => {
    // Guard against a regex so strict it only admits today's two values —
    // the shape is checked, the language list is not this file's business.
    const { db } = fakeDb(() => [ROW]);
    for (const locale of ["fa", "en", "en-GB"]) {
      await expect(createOrgRepo(db).update(IDENTITY, { locale })).resolves.toBeTruthy();
    }
  });

  it("rejects allowed_models containing a non-string or a blank", async () => {
    const { db } = fakeDb(() => [ROW]);
    await expect(createOrgRepo(db).update(IDENTITY, { allowedModels: ["ok", "  "] }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an empty patch rather than issuing a no-op UPDATE", async () => {
    const { db } = fakeDb(() => [ROW]);
    await expect(createOrgRepo(db).update(IDENTITY, {}))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("reports a policy refusal as 404, not as a missing org", async () => {
    // Zero rows from the UPDATE means org_admin_update said no. Same posture
    // as every other invisible row: existence is information.
    const { db } = fakeDb((sql) => (sql.includes("update echo.org") ? [] : [ROW]));
    await expect(createOrgRepo(db).update(IDENTITY, { name: "x" }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
