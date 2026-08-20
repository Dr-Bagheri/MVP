/**
 * Server management reads (M25).
 *
 * Every test here is about the same rule, because it is the rule the surface
 * lives or dies on: **not measured must never render as zero.** FE2 named it
 * precisely — "0 dead letters" reads as healthy on a screen where a person
 * acts on the figure, so a metric we failed to read has to arrive as
 * something a client cannot mistake for a measurement.
 */
import { describe, expect, it } from "vitest";

import { createHealthRepo } from "../src/api/health.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const IDENTITY: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  isActive: true,
};

function fakeDb(answer: (sql: string) => unknown[]) {
  const log: string[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string) => {
        log.push(sql);
        if (sql.includes("set local") || sql.includes("set_config")) return [];
        return answer(sql);
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { db: createDb({ app: make(), agent: make() }), log };
}

const healthy = (sql: string): unknown[] => {
  // The queue block is gated on the platform-root predicate (2026-08-20
  // tenancy audit) — the baseline caller here is a root so the metric tests
  // keep exercising the counting; the gate itself is pinned both ways below.
  if (sql.includes("actor_is_platform_root")) return [{ is_platform_root: true }];
  if (sql.includes("list_queues")) return [{ queue_name: "echo_summarize" }];
  if (sql.includes("pgmq.q_")) return [{ n: 4, retrying: 1 }];
  if (sql.includes("pgmq.a_")) return [{ n: 22 }];
  if (sql.includes("echo.api_key")) return [{ active: 2, revoked: 1 }];
  return [];
};

describe("an unmeasured metric is never a zero", () => {
  it("reports storage as unavailable with a reason, not as 0 bytes", async () => {
    // echo_app cannot read the storage schema at all (42501). Reporting 0
    // would say "you are using no storage", which is a measurement.
    const { db } = fakeDb(healthy);
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.storage.bytes).toBeNull();
    expect(health.storage.measured_at).toBeNull();
    expect(health.storage.unavailable).toMatch(/storage/);
  });

  it("leaves measured_at null for a metric whose read was refused", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("pgmq")) throw Object.assign(new Error("no"), { code: "42501" });
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.measured_at).toBeNull();
    expect(health.queues.items).toEqual([]);
    expect(health.queues.unavailable).toBeDefined();
  });

  it("stamps measured_at when the read DID happen, including for a true zero", async () => {
    // The other half of the rule: a real zero must be distinguishable from a
    // missing one, so it arrives WITH a timestamp.
    const { db } = fakeDb((sql) => {
      if (sql.includes("pgmq.q_")) return [{ n: 0, retrying: 0 }];
      if (sql.includes("pgmq.a_")) return [{ n: 0 }];
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.items[0]!.depth).toBe(0);
    expect(health.queues.measured_at).not.toBeNull();
  });
});

describe("one broken source does not blank the others", () => {
  it("still reports keys when the queues are unreadable", async () => {
    // A page-level failure over four working numbers is a lie in the other
    // direction — it understates what is healthy.
    const { db } = fakeDb((sql) => {
      if (sql.includes("pgmq")) throw Object.assign(new Error("no"), { code: "42501" });
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.measured_at).toBeNull();
    expect(health.keys.active).toBe(2);
    expect(health.keys.measured_at).not.toBeNull();
  });

  it("still reports queues when the key count is unreadable", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("echo.api_key")) throw Object.assign(new Error("no"), { code: "42501" });
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.keys.active).toBeNull();
    expect(health.queues.items).toHaveLength(1);
  });
});

describe("the numbers are named for what they actually count", () => {
  it("counts retry pressure separately from the archive", async () => {
    // pgmq's `a_` archive holds SUCCESSES too, so it is not a dead-letter
    // queue. `retrying` (read_ct over the alarm) is the honest proxy, and
    // both are reported under their real names.
    const { db } = fakeDb(healthy);
    const health = await createHealthRepo(db).read(IDENTITY);
    const [queue] = health.queues.items;
    expect(queue).toMatchObject({ name: "echo_summarize", depth: 4, retrying: 1, archived: 22 });
  });

  it("never interpolates a queue name that fails the safety pattern", async () => {
    // Queue names cannot be parameterised, so they are interpolated — from
    // list_queues(), AND re-checked here. The second check is what makes the
    // guarantee local instead of borrowed.
    const { db, log } = fakeDb((sql) => {
      if (sql.includes("list_queues")) return [{ queue_name: "evil; drop table echo.call --" }];
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.items).toEqual([]);
    expect(log.some((sql) => sql.includes("drop table"))).toBe(false);
  });
});

describe("queue depths are a platform fact, never an org fact (2026-08-20)", () => {
  it("an org admin who is not a platform root gets a NAMED refusal, not numbers", async () => {
    // pgmq queues are not org-scoped, so their counts are deployment-wide —
    // an org admin reading them learns how busy every other tenant is. The
    // refusal names itself so the screen shows a reason, never an empty list
    // that reads as "no queues".
    const { db, log } = fakeDb((sql) => {
      if (sql.includes("actor_is_platform_root")) return [{ is_platform_root: false }];
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.items).toEqual([]);
    expect(health.queues.measured_at).toBeNull();
    expect(health.queues.unavailable).toMatch(/platform/);
    // The discriminating half: the counting queries were never even issued.
    expect(log.some((sql) => sql.includes("pgmq"))).toBe(false);
    // And the org-scoped metric beside it still answers — the gate is on the
    // cross-tenant number, not on the page.
    expect(health.keys.active).toBe(2);
  });

  it("a platform root gets the numbers", async () => {
    const { db } = fakeDb(healthy);
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.items).toHaveLength(1);
    expect(health.queues.measured_at).not.toBeNull();
  });
});

describe("failures do not leak database prose", () => {
  it("reports a code, never the postgres message", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("pgmq")) {
        throw Object.assign(new Error('permission denied for relation "call" row (secret text)'), {
          code: "42501",
        });
      }
      return healthy(sql);
    });
    const health = await createHealthRepo(db).read(IDENTITY);
    expect(health.queues.unavailable).not.toMatch(/secret/);
  });
});
