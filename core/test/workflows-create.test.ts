/**
 * Org-authored workflows (0072; user directive 2026-08-20: "create workflow,
 * full function"). The route is admin-gated and the RLS insert policy
 * re-asserts it; these tests pin the layer THIS file owns — validation,
 * the server-generated slug, and that org/creator come from the IDENTITY,
 * never from the body (a fact must not be supplyable, 0029).
 */
import { describe, expect, it } from "vitest";

import { createWorkflow } from "../src/api/workflows.ts";
import { ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ADMIN: Identity = {
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
        if (sql.includes("insert into echo.workflow_template")) {
          return [{
            id: "33333333-3333-4333-8333-333333333333",
            slug: params?.[0], name: params?.[1], description: params?.[2],
            source_kind: params?.[3], instructions: params?.[4], icon: "sparkles", color: "violet",
          }];
        }
        return [];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

describe("createWorkflow", () => {
  it("creates with a SERVER-generated slug and returns the public card (no instructions)", async () => {
    const { db, log } = fakeDb();
    const card = await createWorkflow(db, ADMIN, {
      name: "آماده‌سازی جلسه", description: "", source_kind: "calendar_event",
      instructions: "خلاصهٔ رویداد انتخاب‌شده را بنویس.",
    });
    expect(card.slug).toMatch(/^wf-[0-9a-f]{8}$/);
    expect(card.name).toBe("آماده‌سازی جلسه");
    // the card is the PUBLIC shape — instructions never ride the wire
    expect("instructions" in card).toBe(false);
    // org and creator come from the IDENTITY, never the body
    const insert = log.find((e) => e.sql.includes("insert into echo.workflow_template"));
    expect(insert?.params?.[5]).toBe(ADMIN.orgId);
    expect(insert?.params?.[6]).toBe(ADMIN.userId);
  });

  it("refuses a missing name, missing instructions, or unknown source kind — before any SQL", async () => {
    const { db, log } = fakeDb();
    await expect(createWorkflow(db, ADMIN, { name: " ", source_kind: "calendar_event", instructions: "x" }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createWorkflow(db, ADMIN, { name: "n", source_kind: "calendar_event", instructions: "  " }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createWorkflow(db, ADMIN, { name: "n", source_kind: "webhook", instructions: "x" }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log.filter((e) => e.sql.includes("insert"))).toHaveLength(0);
  });
});
