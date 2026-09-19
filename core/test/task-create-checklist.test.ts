import { describe, expect, it } from "vitest";
import { createTasksRepo } from "../src/api/tasks.ts";
import { ValidationError } from "../src/api/errors.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * A card can be born with its CHECKLIST (2026-09-19, «کپی»).
 *
 * The board's copy sends the source's steps with each card it makes, so the
 * create takes them in the SAME transaction as the card — the assignees'
 * reasoning (0186) applied to the steps: a copy with half a checklist is a
 * card that lies about what the work is, and one addChecklistItem per line
 * after the create is exactly how a copy comes to have half of one.
 *
 * The fake answers by SQL fragment and records every statement in order, so
 * the assertions are on what the database was ASKED — the order of the
 * lines, their positions, the absence of a `done` — rather than on a mock
 * that agreed with the author (rule 10). The refusals are pinned with what
 * they leave behind: NOTHING, because the parse runs before the transaction
 * opens, and a refused copy must not leave a card with no steps on the board.
 */
const identity = { userId: "u-1", orgId: "org-a", role: "member" } as unknown as Identity;

interface Sent { sql: string; args: unknown[] }

function fakeDb() {
  const sent: Sent[] = [];
  /* the CARD_ROWS shape the detail reads back after the create */
  const card = {
    id: "t-new", column_id: "c-1", topic_id: null, call_id: null, call_title: null,
    meeting_id: null, meeting_title: null, title: "کپی گزارش", priority: "medium",
    labels: [], due_at: null, done_at: null, position: 0, archived_at: null,
    created_by: "u-1", created_at: new Date("2026-09-19T00:00:00Z"), recurrence_id: null,
    channel_id: null, channel_name: null,
    checklist_total: 0, checklist_done: 0, comment_count: 0, assignee_ids: [], label_ids: [],
  };
  const tx = {
    unsafe: async (sql: string, args: unknown[] = []) => {
      sent.push({ sql, args });
      const s = sql.replace(/\s+/g, " ");
      if (s.startsWith("insert into echo.task (")) return [{ id: "t-new" }];
      if (s.includes("from echo.task t") && s.includes("where t.id = $1") && s.includes("channel_name")) return [card];
      if (s.includes("select description from echo.task")) return [{ description: "" }];
      return [];
    },
  };
  const db = {
    withIdentity: async (_id: Identity, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    withoutIdentity: async () => [],
    withActor: async () => [],
  } as never;
  return { db, sent };
}

const squash = (sql: string) => sql.replace(/\s+/g, " ");
const lines = (sent: Sent[]) => sent
  .filter((s) => squash(s.sql).startsWith("insert into echo.task_checklist_item"))
  .map((s) => ({ label: s.args[1], position: s.args[2] }));

describe("a task born with its checklist", () => {
  it("writes the lines in the order given, positions 1..n, trimmed, inside the create's own transaction", async () => {
    const { db, sent } = fakeDb();
    await createTasksRepo(db).create(identity, {
      title: "کپی گزارش", column_id: "c-1", checklist: ["  داده‌ها را جمع کن ", "نمودار را بکش"],
    });

    expect(lines(sent)).toEqual([
      { label: "داده‌ها را جمع کن", position: 1 },
      { label: "نمودار را بکش", position: 2 },
    ]);
    /* the ORDER of statements is the transaction: the card first, then its
       steps, and the detail's read-back only after — a step written before
       the card has no task_id, and one written after the read-back is not in
       the answer the client gets */
    const at = (needle: string) => sent.findIndex((s) => squash(s.sql).startsWith(needle));
    const taskInsert = at("insert into echo.task (");
    const firstStep = at("insert into echo.task_checklist_item");
    const readBack = sent.findIndex((s) => squash(s.sql).includes("channel_name"));
    expect(taskInsert).toBeGreaterThanOrEqual(0);
    expect(firstStep).toBeGreaterThan(taskInsert);
    expect(readBack).toBeGreaterThan(firstStep);
  });

  it("leaves `done` to the row's default — a card born with ticked boxes is a card born finished", async () => {
    const { db, sent } = fakeDb();
    await createTasksRepo(db).create(identity, { title: "کپی", column_id: "c-1", checklist: ["گام"] });
    const insert = sent.find((s) => squash(s.sql).startsWith("insert into echo.task_checklist_item"))!;
    /* the column list is the claim: (task_id, org_id, label, position) and
       no `done` — the renewal writes `false` by name; here the default says
       the same thing and cannot be handed a `true` by a caller */
    expect(squash(insert.sql)).toContain("(task_id, org_id, label, position)");
    expect(squash(insert.sql)).not.toMatch(/\bdone\b/);
  });

  it("no checklist means no lines — absent, null and an empty list alike", async () => {
    for (const checklist of [undefined, null, []]) {
      const { db, sent } = fakeDb();
      await createTasksRepo(db).create(identity, { title: "عادی", column_id: "c-1", checklist });
      expect(lines(sent), `checklist=${JSON.stringify(checklist)}`).toEqual([]);
      /* and the card itself was still made — the control that separates
         "no steps" from "refused" */
      expect(sent.some((s) => squash(s.sql).startsWith("insert into echo.task ("))).toBe(true);
    }
  });

  it("refuses a blank line — and writes NOTHING, not a card with the other steps", async () => {
    const { db, sent } = fakeDb();
    const refused = createTasksRepo(db).create(identity, {
      title: "کپی", column_id: "c-1", checklist: ["گام یک", "   ", "گام سه"],
    });
    await expect(refused).rejects.toBeInstanceOf(ValidationError);
    await expect(refused).rejects.toMatchObject({ code: "task_checklist_invalid" });
    /* the parse runs before the transaction: not one statement was sent */
    expect(sent).toEqual([]);
  });

  it("refuses a line that is not words, one past 500 characters, a list past fifty, and a non-list", async () => {
    const cases: unknown[] = [
      [42],
      ["ا".repeat(501)],
      Array.from({ length: 51 }, (_, i) => `گام ${i}`),
      "گام یک",
    ];
    for (const checklist of cases) {
      const { db, sent } = fakeDb();
      await expect(createTasksRepo(db).create(identity, { title: "کپی", column_id: "c-1", checklist }))
        .rejects.toMatchObject({ code: "task_checklist_invalid" });
      expect(sent, `left a statement behind for ${JSON.stringify(checklist).slice(0, 40)}`).toEqual([]);
    }
    /* the CONTROL on the ceiling: exactly fifty is accepted */
    const { db, sent } = fakeDb();
    await createTasksRepo(db).create(identity, {
      title: "کپی", column_id: "c-1", checklist: Array.from({ length: 50 }, (_, i) => `گام ${i}`),
    });
    expect(lines(sent)).toHaveLength(50);
  });
});
