/**
 * THE ALARMS (db/0231, db/0232).
 *
 * User directive, 2026-09-18: a settings page that sets a time and pops up in
 * the platform; agents can set one for you; a task near its deadline alarms;
 * an upcoming meeting alarms half an hour before, including one somebody has
 * just added you to.
 *
 * ── what is worth asserting here, and what is not ─────────────────────────
 *
 * WHO may read whose alarms is the DATABASE's answer and is asserted in
 * db/test/134 against real RLS — a fake here would be a fake of the very
 * composition the policies perform (rule 11: fake at the right altitude).
 *
 * What THIS file holds is the part core/ actually decides and that nothing
 * else can see:
 *
 *   · the KEY, which is the whole mechanism by which an alarm fires once and
 *     fires again when the moment moves;
 *   · which windows each kind uses, and that an alarm already acknowledged
 *     does not come back;
 *   · that `ack` routes a stored alarm and a computed one to two different
 *     writes without the caller choosing.
 *
 * The SQL is asserted by SHAPE where the shape is the rule — a task query
 * that forgot `done_at is null` would alarm about finished work forever, and
 * no fixture of rows can show that, because the fake is what returns them.
 */
import { describe, expect, it } from "vitest";

import { createRemindersRepo, MEETING_LEAD_MS, TASK_LEAD_MS } from "../src/api/reminders.ts";
import { ValidationError } from "../src/api/errors.ts";
import { createDb, type SqlClient, type SqlTx } from "../src/db/identity.ts";
import type { Identity } from "../src/agent/types.ts";

const ME: Identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "org-a", role: "member", isActive: true,
};

/**
 * The fake answers BY QUERY rather than by call order, which matters: `due`
 * makes four reads and an order-keyed fake would pass against a version that
 * asked them in a different order, or asked one of them twice.
 */
function fakeDb(rowsFor: (sql: string, params: unknown[]) => unknown[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const make = (): SqlClient => ({
    async begin<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      const tx = (async () => []) as unknown as SqlTx;
      (tx as unknown as { unsafe: SqlTx["unsafe"] }).unsafe = (async (sql: string, params: unknown[] = []) => {
        log.push({ sql, params });
        return rowsFor(sql, params) as never[];
      }) as SqlTx["unsafe"];
      return fn(tx);
    },
    async end() {},
  });
  return { log, db: createDb({ app: make(), agent: make() }) };
}

const NOW = new Date("2026-09-18T10:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

/** rows for the four reads `due` makes, chosen by what the SQL is about */
const answering = (rows: {
  custom?: unknown[]; tasks?: unknown[]; meetings?: unknown[]; acked?: string[];
}) => (sql: string) => {
  if (sql.includes("echo.reminder_ack")) return (rows.acked ?? []).map((key) => ({ key }));
  if (sql.includes("from echo.reminder")) return rows.custom ?? [];
  if (sql.includes("from echo.task")) return rows.tasks ?? [];
  if (sql.includes("from echo.meeting")) return rows.meetings ?? [];
  return [];
};

describe("what should wake somebody now", () => {
  it("carries the MOMENT in a computed alarm's key, not just the id", async () => {
    /*
     * The whole reason a deadline that moves alarms again. A key of
     * `task:<id>` would be acknowledged once and silence that card forever —
     * including after somebody pushed the deadline out and pulled it back in.
     */
    const { db } = fakeDb(answering({
      tasks: [{ id: "t-1", title: "دیتاست صوتی", due_at: at(20 * 60 * 1000) }],
      meetings: [{ id: "m-1", title: "هفتگی", scheduled_at: at(10 * 60 * 1000) }],
    }));
    const alarms = await createRemindersRepo(db).due(ME, NOW);
    expect(alarms.map((a) => a.key)).toEqual([
      `meeting:m-1:${at(10 * 60 * 1000)}`,
      `task:t-1:${at(20 * 60 * 1000)}`,
    ]);
    /* and the pointer that makes the pop-up openable */
    expect(alarms.find((a) => a.kind === "task")?.task_id).toBe("t-1");
    expect(alarms.find((a) => a.kind === "meeting")?.meeting_id).toBe("m-1");
  });

  it("drops the ones already acknowledged, and keeps the rest", async () => {
    // BOTH halves: a version that filters everything satisfies the first
    // assertion on its own and is completely broken.
    const { db } = fakeDb(answering({
      tasks: [
        { id: "t-1", title: "seen", due_at: at(5 * 60 * 1000) },
        { id: "t-2", title: "new", due_at: at(6 * 60 * 1000) },
      ],
      acked: [`task:t-1:${at(5 * 60 * 1000)}`],
    }));
    const alarms = await createRemindersRepo(db).due(ME, NOW);
    expect(alarms.map((a) => a.label)).toEqual(["new"]);
  });

  it("asks for each kind in its OWN window — thirty minutes for a meeting, an hour for a task", async () => {
    /*
     * The user's own number for meetings ("half an hour before"), and a
     * judgement for tasks. Asserted on the PARAMETERS rather than on rows,
     * because the fake is what returns the rows: a repo that asked for a
     * seven-day horizon would pass every row-shaped assertion in this file.
     */
    const { db, log } = fakeDb(answering({}));
    await createRemindersRepo(db).due(ME, NOW);
    const task = log.find((q) => q.sql.includes("from echo.task"));
    const meeting = log.find((q) => q.sql.includes("from echo.meeting"));
    expect(task?.params[0]).toBe(at(TASK_LEAD_MS));
    expect(meeting?.params[1]).toBe(at(MEETING_LEAD_MS));
    /* a meeting already under way is not news: its floor is NOW */
    expect(meeting?.params[0]).toBe(NOW.toISOString());
  });

  it("never alarms about a finished or archived task", async () => {
    // The rule lives in the SQL, so the SQL is where it is asserted — a
    // fixture cannot express a row the query would not have returned.
    const { db, log } = fakeDb(answering({}));
    await createRemindersRepo(db).due(ME, NOW);
    const task = log.find((q) => q.sql.includes("from echo.task"))!;
    expect(task.sql).toContain("t.done_at is null");
    expect(task.sql).toContain("t.archived_at is null");
  });

  it("alarms about the caller's OWN work, not the whole board", async () => {
    /*
     * ── WHAT THIS ASSERTION CAN AND CANNOT DO, said rather than dressed up ──
     *
     * It reads the SQL, so it can prove the ownership predicate is THERE and
     * it cannot prove the predicate BITES. Found by verify-red: neutering it
     * to `true or exists (…)` left this test green, because the neutered
     * query still contains every string below. A fixture cannot help — the
     * fake is what returns the rows, so it can only ever agree with itself.
     *
     * The `true or` guard is therefore narrow on purpose and is named as
     * narrow: it catches the one shape a neutering takes and claims nothing
     * more. What would actually prove it is core's query run against seeded
     * rows under two different actors, which is db/test's altitude and waits
     * for the day this query moves behind a view or a definer door — a copy
     * of the SQL text in a db test would be two spellings of one query, and
     * the second one is the one that stops matching.
     */
    const { db, log } = fakeDb(answering({}));
    await createRemindersRepo(db).due(ME, NOW);
    const task = log.find((q) => q.sql.includes("from echo.task"))!;
    expect(task.sql).toContain("echo.task_assignee");
    expect(task.sql).toContain("a.user_id = echo.actor_id()");
    /* the creator's branch, for a card nobody has been given: without it a
       task you made and own alone would never alarm */
    expect(task.sql).toContain("t.created_by = echo.actor_id()");
    expect(task.sql, "the ownership filter was short-circuited").not.toMatch(/\b(true\s+or|or\s+true)\b/i);
    /* and a meeting the caller is ON — the half the user asked for by name:
       being ADDED to a meeting is what creates the attendee row, so no
       trigger and no fan-out is needed for "it shows you half an hour
       before" to be true the moment somebody adds you */
    const meeting = log.find((q) => q.sql.includes("from echo.meeting"))!;
    expect(meeting.sql).toContain("echo.meeting_attendee");
    expect(meeting.sql).toContain("a.user_id = echo.actor_id()");
  });

  it("sorts by the moment, so the pop-up shows the most urgent first", async () => {
    const { db } = fakeDb(answering({
      custom: [{ id: "r-1", at: at(25 * 60 * 1000), label: "later" }],
      tasks: [{ id: "t-1", title: "sooner", due_at: at(2 * 60 * 1000) }],
    }));
    const alarms = await createRemindersRepo(db).due(ME, NOW);
    expect(alarms.map((a) => a.label)).toEqual(["sooner", "later"]);
  });
});

describe("setting one", () => {
  it("writes the caller into every identity column, and takes neither from the caller", async () => {
    /* an alarm for somebody else is not a feature: the columns are filled by
       the DATABASE's own functions, so the route has nothing to get wrong */
    const { db, log } = fakeDb(() => [{
      id: "r-1", at: at(0), label: "x", dismissed_at: null, created_at: at(0),
    }]);
    await createRemindersRepo(db).create(ME, at(60 * 60 * 1000), "  دیتاست صوتی  ");
    const write = log.find((q) => q.sql.includes("insert into echo.reminder"))!;
    expect(write.sql).toContain("echo.actor_id()");
    expect(write.sql).not.toContain("$3");
    /* trimmed, because a label of spaces is an alarm with nothing to say */
    expect(write.params[1]).toBe("دیتاست صوتی");
  });

  it("refuses an empty label and an unparseable instant", async () => {
    const { db, log } = fakeDb(() => []);
    const repo = createRemindersRepo(db);
    await expect(repo.create(ME, at(0), "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.create(ME, "not a date", "x")).rejects.toBeInstanceOf(ValidationError);
    /* and neither reached the database: a refusal at the mistake, not at the
       constraint, and nothing written on the way */
    expect(log).toHaveLength(0);
  });

  it("reports a REFUSED write as a refusal, never as a saved alarm", async () => {
    // The policy returning zero rows is how a pending member's insert ends
    // (0232). Returning success there would put an alarm on the screen that
    // does not exist — a write path reporting "saved" about nothing.
    const { db } = fakeDb(() => []);
    await expect(createRemindersRepo(db).create(ME, at(0), "x"))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe("saying you have seen one", () => {
  it("dismisses a STORED alarm on its own row", async () => {
    const { db, log } = fakeDb(() => [{ id: "r-1" }]);
    expect(await createRemindersRepo(db).ack(ME, "reminder:r-1")).toEqual({ acknowledged: true });
    const write = log.find((q) => q.sql.includes("update echo.reminder"))!;
    expect(write.params[0]).toBe("r-1");
    expect(log.some((q) => q.sql.includes("reminder_ack"))).toBe(false);
  });

  it("records a COMPUTED alarm in the ack table instead", async () => {
    const { db, log } = fakeDb(() => []);
    const key = `task:t-1:${at(0)}`;
    expect(await createRemindersRepo(db).ack(ME, key)).toEqual({ acknowledged: true });
    const write = log.find((q) => q.sql.includes("insert into echo.reminder_ack"))!;
    expect(write.params[0]).toBe(key);
    /* twice is not an error: the caller asked for this alarm to stop and it
       has stopped. `do nothing` is what makes pressing twice harmless. */
    expect(write.sql).toContain("do nothing");
  });

  it("refuses a key it did not compose", async () => {
    // The prefixes are the server's own invention, so a key from anywhere
    // else is a caller making something up — and the ack table would happily
    // store it, which is why this is refused here rather than there.
    const { db, log } = fakeDb(() => []);
    await expect(createRemindersRepo(db).ack(ME, "delete:everything"))
      .rejects.toBeInstanceOf(ValidationError);
    expect(log).toHaveLength(0);
  });
});
