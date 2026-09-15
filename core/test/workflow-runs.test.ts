/**
 * M41 P4 — the schedule's FIRST firing, and the read the page shows.
 *
 * The bug this pins (2026-09-08): `schedule()` computed next_due in SQL
 * from `at_minute` alone, so a WEEKLY schedule's `weekday` was stored and
 * never consulted — Monday 08:00, created on a Wednesday, first fired
 * Thursday 08:00 and every seventh day after. `nextDueAfter` is pure and
 * exported, so the arithmetic is asserted on fixed clocks rather than on
 * whatever day the suite happens to run; and the repo test proves the
 * value it inserts is that function's, not the old expression's.
 *
 * Every fixture clock is UTC on purpose — v1 timing is UTC on the record.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/api/errors.ts";
import { createWorkflowRunsRepo, nextDueAfter } from "../src/api/workflow-runs.ts";
import type { Db } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

/* Wednesday 2026-09-09 10:30:00 UTC */
const WEDNESDAY = new Date("2026-09-09T10:30:00.000Z");
const MONDAY = 1;
const EIGHT = 8 * 60;

describe("nextDueAfter — strictly in the future, on the named day", () => {
  it("weekly: the NEXT Monday at 08:00 UTC from a Wednesday — five days out, not tomorrow", () => {
    const due = nextDueAfter(WEDNESDAY, "weekly", EIGHT, MONDAY);
    expect(due.toISOString()).toBe("2026-09-14T08:00:00.000Z");
    expect(due.getUTCDay()).toBe(MONDAY);
  });

  it("weekly: on the weekday itself, an at_minute still ahead is TODAY", () => {
    const mondayMorning = new Date("2026-09-14T06:00:00.000Z");
    expect(nextDueAfter(mondayMorning, "weekly", EIGHT, MONDAY).toISOString())
      .toBe("2026-09-14T08:00:00.000Z");
  });

  it("weekly: on the weekday itself, an at_minute already passed is a WEEK out — never in the past", () => {
    const mondayNoon = new Date("2026-09-14T12:00:00.000Z");
    expect(nextDueAfter(mondayNoon, "weekly", EIGHT, MONDAY).toISOString())
      .toBe("2026-09-21T08:00:00.000Z");
    /* the exact minute is not "still ahead" either */
    const mondayEight = new Date("2026-09-14T08:00:00.000Z");
    expect(nextDueAfter(mondayEight, "weekly", EIGHT, MONDAY).toISOString())
      .toBe("2026-09-21T08:00:00.000Z");
  });

  it("weekly: every weekday 0..6 lands on that weekday, 1..7 days from a fixed clock", () => {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const due = nextDueAfter(WEDNESDAY, "weekly", 0, weekday);
      expect(due.getUTCDay(), `weekday ${weekday}`).toBe(weekday);
      const days = (due.getTime() - WEDNESDAY.getTime()) / 86_400_000;
      expect(days, `weekday ${weekday}`).toBeGreaterThan(0);
      expect(days, `weekday ${weekday}`).toBeLessThanOrEqual(7);
    }
  });

  it("daily: unchanged — today's at_minute if ahead, else tomorrow's", () => {
    expect(nextDueAfter(WEDNESDAY, "daily", 11 * 60, null).toISOString())
      .toBe("2026-09-09T11:00:00.000Z");
    expect(nextDueAfter(WEDNESDAY, "daily", EIGHT, null).toISOString())
      .toBe("2026-09-10T08:00:00.000Z");
  });

  it("monthly: unchanged — this month's day if ahead, else next month's", () => {
    expect(nextDueAfter(WEDNESDAY, "monthly", 11 * 60, null).toISOString())
      .toBe("2026-09-09T11:00:00.000Z");
    expect(nextDueAfter(WEDNESDAY, "monthly", EIGHT, null).toISOString())
      .toBe("2026-10-09T08:00:00.000Z");
  });
});

/* ── the repo inserts THAT value ─────────────────────────────────────── */

interface Recorded { sql: string; params: unknown[] }

function scriptedDb(respond: (sql: string, params: unknown[]) => unknown[] | undefined) {
  const calls: Recorded[] = [];
  const tx = {
    unsafe: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return Promise.resolve(respond(sql, params) ?? []);
    },
  };
  const db = {
    withIdentity: (_i: unknown, fn: (t: unknown) => unknown) => fn(tx),
    withoutIdentity: (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as Db;
  return { db, calls };
}

const OWNER = "02000000-0000-4000-8000-000000000002";
const ORG = "0a000000-0000-4000-8000-00000000000a";
const WORKFLOW = "94000000-0000-4000-8000-000000000001";
const IDENTITY = { userId: OWNER, orgId: ORG, role: "member", isActive: true } as unknown as Identity;

describe("schedule() — the row carries the weekday's next_due", () => {
  it("weekly Monday 08:00 from a Wednesday inserts the coming Monday, with weekday kept", async () => {
    const { db, calls } = scriptedDb((sql) => {
      if (/select id from echo\.workflow where handle/i.test(sql)) return [{ id: WORKFLOW }];
      if (/insert into echo\.workflow_schedule/i.test(sql)) {
        return [{ id: "s-1", next_due: "2026-09-14T08:00:00.000Z" }];
      }
      return undefined;
    });
    const repo = createWorkflowRunsRepo(db);
    const result = await repo.schedule(IDENTITY, "wf-starter-tasks-digest",
      { cadence: "weekly", weekday: MONDAY, at_minute: EIGHT }, WEDNESDAY);
    const insert = calls.find((c) => /insert into echo\.workflow_schedule/i.test(c.sql))!;
    expect(insert.params.slice(0, 7)).toEqual([
      ORG, OWNER, WORKFLOW, "weekly", EIGHT, MONDAY, "2026-09-14T08:00:00.000Z",
    ]);
    /* the value is a PARAMETER — the old date_trunc expression is gone */
    expect(insert.sql).not.toMatch(/date_trunc/);
    expect(result).toEqual({ schedule_id: "s-1", next_due: "2026-09-14T08:00:00.000Z" });
  });

  it("weekly without a weekday is refused by name — never 'every seven days from now'", async () => {
    const { db, calls } = scriptedDb(() => undefined);
    await expect(createWorkflowRunsRepo(db).schedule(IDENTITY, "wf-x", { cadence: "weekly" }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
  });

  it("daily stores no weekday even when one is sent — the column means something only on weekly", async () => {
    const { db, calls } = scriptedDb((sql) => {
      if (/select id from echo\.workflow where id/i.test(sql)) return [{ id: WORKFLOW }];
      if (/insert into echo\.workflow_schedule/i.test(sql)) {
        return [{ id: "s-2", next_due: "2026-09-10T08:00:00.000Z" }];
      }
      return undefined;
    });
    await createWorkflowRunsRepo(db).schedule(IDENTITY, WORKFLOW,
      { cadence: "daily", weekday: 3, at_minute: EIGHT }, WEDNESDAY);
    const insert = calls.find((c) => /insert into echo\.workflow_schedule/i.test(c.sql))!;
    expect(insert.params[5]).toBeNull();
    expect(insert.params[6]).toBe("2026-09-10T08:00:00.000Z");
  });
});

describe("schedules() — the read the page shows", () => {
  it("resolves by handle, joins the live workflow, and shapes the row", async () => {
    const { db, calls } = scriptedDb((sql) => {
      if (/from echo\.workflow_schedule s/i.test(sql)) {
        return [{
          id: "s-1", workflow_id: WORKFLOW, owner_id: OWNER, cadence: "weekly",
          at_minute: 480, weekday: 1, next_due: new Date("2026-09-14T08:00:00.000Z"),
          last_fired_at: null, enabled: true,
        }];
      }
      return undefined;
    });
    const rows = await createWorkflowRunsRepo(db).schedules(IDENTITY, "wf-starter-tasks-digest");
    expect(rows).toEqual([{
      id: "s-1", workflow_id: WORKFLOW, owner_id: OWNER, cadence: "weekly",
      at_minute: 480, weekday: 1, next_due: "2026-09-14T08:00:00.000Z",
      last_fired_at: null, enabled: true,
    }]);
    const read = calls[0]!;
    expect(read.sql).toMatch(/w\.handle = \$1/);
    expect(read.sql).toMatch(/archived_at is null/);
    expect(read.params).toEqual(["wf-starter-tasks-digest"]);
  });
});
