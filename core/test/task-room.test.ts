import { describe, expect, it } from "vitest";
import { createTasksRepo } from "../src/api/tasks.ts";
import { ConflictError, NotActivatedError } from "../src/api/errors.ts";
import type { Identity } from "../src/agent/types.ts";

/**
 * db/0227 — the task's room, the repo's half.
 *
 * The WALL (an admin's to set) and the SEATING (whoever is assigned is in
 * the room) are the database's, and db/test/130 walks them against real
 * RLS. What the repo owns is smaller and worth pinning on its own: the
 * pointer travels in the PATCH, the history says which room by NAME (the
 * row may not point at it later), the trigger's refusal is translated into
 * the 403 it is rather than the 404 every other write refusal maps to, and
 * «new room» is ONE transaction — channel, seat, pointer, note.
 *
 * The fake answers by SQL fragment and records every statement in order,
 * so the assertions are on what the database was asked, not on a mock that
 * agreed with the author.
 */
const identity = { userId: "u-admin", orgId: "org-a", role: "admin" } as unknown as Identity;

interface Sent { sql: string; args: unknown[] }

function fakeDb(opts: { channelId?: string | null; throwOnUpdate?: { code: string; hint?: string }; insertCode?: string } = {}) {
  const sent: Sent[] = [];
  const card = {
    id: "t-1", column_id: "c-1", topic_id: null, call_id: null, call_title: null,
    meeting_id: null, meeting_title: null, title: "بررسی پلتفرم", priority: "medium",
    labels: [], due_at: null, done_at: null, position: 1, archived_at: null,
    created_by: "u-admin", created_at: new Date("2026-09-16T00:00:00Z"), recurrence_id: null,
    channel_id: opts.channelId ?? null, channel_name: opts.channelId ? "تیم فنی" : null,
    checklist_total: 0, checklist_done: 0, comment_count: 0, assignee_ids: [], label_ids: [],
  };
  const tx = {
    unsafe: async (sql: string, args: unknown[] = []) => {
      sent.push({ sql, args });
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("select t.title, t.priority, t.done_at")) {
        return [{ title: card.title, priority: card.priority, done_at: null, archived_at: null,
                  due_at: null, column_name: "برای انجام", channel_id: card.channel_id }];
      }
      if (s.startsWith("update echo.task set")) {
        if (opts.throwOnUpdate) throw Object.assign(new Error("refused"), opts.throwOnUpdate);
        return [{ id: "t-1", done_now: false }];
      }
      if (s.startsWith("insert into echo.chat_channel (")) {
        if (opts.insertCode) throw Object.assign(new Error("dup"), { code: opts.insertCode });
        return [{ id: "r-new" }];
      }
      if (s.includes("select name from echo.chat_channel")) return [{ name: "تیم فنی" }];
      if (s.includes("select title from echo.task where id")) return [{ title: card.title }];
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

const eventsOf = (sent: Sent[]) =>
  sent.filter((s) => s.sql.includes("insert into echo.task_event")).map((s) => ({ kind: s.args[1], detail: JSON.parse(String(s.args[2])) }));

describe("the room in the PATCH", () => {
  it("points the card at a room, and the history names the room", async () => {
    const { db, sent } = fakeDb();
    const detail = await createTasksRepo(db).update(identity, "t-1", { channel_id: "r-1" });
    const update = sent.find((s) => s.sql.startsWith("update echo.task set"))!;
    expect(update.sql).toContain("channel_id = $2");
    expect(update.args).toEqual(["t-1", "r-1"]);
    expect(eventsOf(sent)).toEqual([{ kind: "room_set", detail: { room: "تیم فنی" } }]);
    expect(detail.id).toBe("t-1");
  });

  it("null clears, and the history says so without a name", async () => {
    const { db, sent } = fakeDb({ channelId: "r-1" });
    await createTasksRepo(db).update(identity, "t-1", { channel_id: null });
    const update = sent.find((s) => s.sql.startsWith("update echo.task set"))!;
    expect(update.args).toEqual(["t-1", null]);
    expect(eventsOf(sent)).toEqual([{ kind: "room_cleared", detail: {} }]);
  });

  it("the same room again is not an event — nothing moved", async () => {
    const { db, sent } = fakeDb({ channelId: "r-1" });
    await createTasksRepo(db).update(identity, "t-1", { channel_id: "r-1" });
    expect(eventsOf(sent)).toEqual([]);
  });

  it("the trigger's refusal is a 403 that names the rule — and a policy's 42501 is left alone (the control)", async () => {
    const refused = createTasksRepo(fakeDb({ throwOnUpdate: { code: "42501", hint: "task_room_admin_only" } }).db);
    await expect(refused.update(identity, "t-1", { channel_id: "r-1" }))
      .rejects.toMatchObject({ kind: "forbidden" });
    await expect(refused.update(identity, "t-1", { channel_id: "r-1" }))
      .rejects.toBeInstanceOf(NotActivatedError);

    /* any other 42501 keeps its own mapping (a policy refusing a row → 404) */
    const other = createTasksRepo(fakeDb({ throwOnUpdate: { code: "42501" } }).db);
    await expect(other.update(identity, "t-1", { title: "x" })).rejects.not.toBeInstanceOf(NotActivatedError);
  });
});

describe("«new room» — one transaction", () => {
  it("makes the channel named after the card, seats the maker, points the card, and writes the history — in that order", async () => {
    const { db, sent } = fakeDb();
    const detail = await createTasksRepo(db).createRoom(identity, "t-1");
    const order = sent.map((s) => s.sql.replace(/\s+/g, " ").slice(0, 40));
    const at = (fragment: string) => order.findIndex((o) => o.includes(fragment));
    expect(at("insert into echo.chat_channel (")).toBeGreaterThan(-1);
    expect(at("insert into echo.chat_channel_member")).toBeGreaterThan(at("insert into echo.chat_channel ("));
    expect(at("update echo.task set channel_id")).toBeGreaterThan(at("insert into echo.chat_channel_member"));
    expect(at("insert into echo.task_event")).toBeGreaterThan(at("update echo.task set channel_id"));
    const channel = sent.find((s) => s.sql.includes("insert into echo.chat_channel ("))!;
    expect(channel.args).toEqual(["بررسی پلتفرم"]);
    expect(eventsOf(sent)).toEqual([{ kind: "room_set", detail: { room: "بررسی پلتفرم" } }]);
    expect(detail.id).toBe("t-1");
  });

  it("takes a name when one is given, cut to the column's ceiling", async () => {
    const { db, sent } = fakeDb();
    await createTasksRepo(db).createRoom(identity, "t-1", `  ${"ا".repeat(100)}  `);
    const channel = sent.find((s) => s.sql.includes("insert into echo.chat_channel ("))!;
    expect(String(channel.args[0])).toHaveLength(80);
  });

  it("a taken name is chat's own 409, with the name in it", async () => {
    const repo = createTasksRepo(fakeDb({ insertCode: "23505" }).db);
    await expect(repo.createRoom(identity, "t-1")).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.createRoom(identity, "t-1")).rejects.toMatchObject({ code: "chat_name_taken" });
  });

  it("the trigger's refusal reaches the caller as the same 403 here", async () => {
    const repo = createTasksRepo(fakeDb({ throwOnUpdate: { code: "42501", hint: "task_room_admin_only" } }).db);
    await expect(repo.createRoom(identity, "t-1")).rejects.toMatchObject({ kind: "forbidden" });
  });
});
