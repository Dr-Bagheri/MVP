/**
 * 0144 — the task board (the reference adoption, 2026-08-31).
 *
 * Everything here runs as the CALLER through withIdentity; the org-sharing
 * and the org wall are db/0144's policies, and this file adds no second
 * opinion about either. What it does own:
 *
 *   · the LAZY DEFAULTS — a board with no columns gets the reference's four
 *     (backlog / to do / in progress / done) on first read, created as the
 *     reader. Seeding at org creation would put board furniture in a
 *     migration; a board nobody has opened costs nothing this way.
 *   · POSITIONS as midpoints — a card dropped between two cards takes the
 *     mean of their positions, so a move writes one row, never a renumber
 *     of the column.
 *   · counts the board can render without N+1 reads — each card carries its
 *     checklist totals and comment count from one grouped query.
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import { iso } from "./vocabulary.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/* 0147: the tone set widened when the reference's «تغییر رنگ ستون» and its
   coloured label chips came across — still CLOSED, because a free colour is
   how a board stops matching the theme */
export const TASK_COLUMN_TONES = [
  "grey", "blue", "green", "amber", "red", "purple", "teal", "pink",
] as const;
export type TaskColumnTone = (typeof TASK_COLUMN_TONES)[number];

/** labels wear the same closed set as columns */
export const TASK_LABEL_COLORS = TASK_COLUMN_TONES;
export type TaskLabelColor = TaskColumnTone;

export interface TaskLabelRecord {
  id: string;
  name: string;
  color: TaskLabelColor;
}

/** the history's closed vocabulary — the reader renders a sentence per kind */
export const TASK_EVENT_KINDS = [
  "created", "done", "undone", "moved", "renamed", "priority",
  "due_set", "due_cleared", "assigned", "unassigned",
  "label_added", "label_removed", "archived", "restored",
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export interface TaskEventRecord {
  id: string;
  kind: TaskEventKind;
  actor_id: string;
  /** codes and NAMES only — never a description's contents */
  detail: Record<string, string>;
  created_at: string;
}

/** the roster an assignee picker needs: names, never emails or statuses */
export interface OrgPersonRecord {
  id: string;
  display_name: string;
  display_name_en: string | null;
  role: string;
}

export interface TaskColumnRecord {
  id: string;
  name: string;
  tone: TaskColumnTone;
  position: number;
}

export interface TaskTopicRecord {
  id: string;
  name: string;
}

export interface TaskCardRecord {
  id: string;
  column_id: string;
  topic_id: string | null;
  /** the record the task came out of — title resolved when readable, so the
      card can say «از جلسه: …» without a second fetch */
  call_id: string | null;
  call_title: string | null;
  title: string;
  priority: TaskPriority;
  labels: string[];
  due_at: string | null;
  done: boolean;
  position: number;
  archived: boolean;
  created_by: string;
  assignee_ids: string[];
  label_ids: string[];
  checklist_done: number;
  checklist_total: number;
  comment_count: number;
  created_at: string;
}

export interface TaskChecklistItemRecord {
  id: string;
  label: string;
  done: boolean;
  position: number;
}

export interface TaskCommentRecord {
  id: string;
  body: string;
  created_by: string;
  created_at: string;
}

export interface TaskDetailRecord extends TaskCardRecord {
  description: string;
  checklist: TaskChecklistItemRecord[];
  comments: TaskCommentRecord[];
  events: TaskEventRecord[];
}

/** the reference's four, seeded lazily in board order */
const DEFAULT_COLUMNS: ReadonlyArray<{ name_fa: string; tone: TaskColumnTone }> = [
  { name_fa: "بک‌لاگ", tone: "grey" },
  { name_fa: "برای انجام", tone: "blue" },
  { name_fa: "در حال انجام", tone: "amber" },
  { name_fa: "انجام‌شده", tone: "green" },
];

const CARD_ROWS = `
  select t.id, t.column_id, t.topic_id, t.call_id, c.title as call_title,
         t.title, t.priority, t.labels, t.due_at, t.done_at, t.position,
         t.archived_at, t.created_by, t.created_at,
         coalesce(ch.total, 0) as checklist_total,
         coalesce(ch.done, 0) as checklist_done,
         coalesce(cm.n, 0) as comment_count,
         coalesce(asg.ids, '{}') as assignee_ids,
         coalesce(lbl.ids, '{}') as label_ids
    from echo.task t
    left join echo.call c on c.id = t.call_id
    left join lateral (
      select count(*) as total, count(*) filter (where done) as done
        from echo.task_checklist_item i where i.task_id = t.id
    ) ch on true
    left join lateral (
      select count(*) as n from echo.task_comment m where m.task_id = t.id
    ) cm on true
    left join lateral (
      select array_agg(a.user_id) as ids
        from echo.task_assignee a where a.task_id = t.id
    ) asg on true
    left join lateral (
      select array_agg(l.label_id) as ids
        from echo.task_label_link l where l.task_id = t.id
    ) lbl on true`;

function toCard(row: Record<string, unknown>): TaskCardRecord {
  return {
    id: String(row.id),
    column_id: String(row.column_id),
    topic_id: (row.topic_id as string | null) ?? null,
    call_id: (row.call_id as string | null) ?? null,
    call_title: (row.call_title as string | null) ?? null,
    title: String(row.title),
    priority: row.priority as TaskPriority,
    labels: (row.labels as string[]) ?? [],
    due_at: row.due_at === null || row.due_at === undefined ? null : iso(row.due_at),
    done: row.done_at !== null && row.done_at !== undefined,
    position: Number(row.position),
    archived: row.archived_at !== null && row.archived_at !== undefined,
    created_by: String(row.created_by),
    assignee_ids: (row.assignee_ids as string[]) ?? [],
    label_ids: (row.label_ids as string[]) ?? [],
    checklist_done: Number(row.checklist_done),
    checklist_total: Number(row.checklist_total),
    comment_count: Number(row.comment_count),
    created_at: iso(row.created_at),
  };
}

function parsePriority(value: unknown): TaskPriority {
  if (typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  throw new ValidationError("unknown task priority", { code: "task_priority_unknown" });
}

function parseDue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError("unreadable due date", { code: "task_due_invalid" });
  }
  return at.toISOString();
}

export function createTasksRepo(db: Db) {
  /** the whole board in three queries — columns (seeded if absent), topics, cards */
  async function board(identity: Identity, opts: { archived?: boolean } = {}): Promise<{
    columns: TaskColumnRecord[];
    topics: TaskTopicRecord[];
    tasks: TaskCardRecord[];
  }> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      let columns = await tx.unsafe<Record<string, unknown>>(
        `select id, name, tone, position from echo.task_column
          where archived_at is null order by position, created_at`,
      );
      if (columns.length === 0) {
        /* first visit: the reference's four, created as the reader. The
           unique-free insert is safe under a race — two first visitors make
           eight columns in the worst case, which an admin can archive; a
           partial unique on (org, name) would turn the race into a 500. */
        for (const [i, def] of DEFAULT_COLUMNS.entries()) {
          await tx.unsafe(
            `insert into echo.task_column (org_id, name, tone, position, created_by)
             values (echo.actor_org_id(), $1, $2, $3, echo.actor_id())`,
            [def.name_fa, def.tone, i + 1],
          );
        }
        columns = await tx.unsafe<Record<string, unknown>>(
          `select id, name, tone, position from echo.task_column
            where archived_at is null order by position, created_at`,
        );
      }
      const topics = await tx.unsafe<Record<string, unknown>>(
        `select id, name from echo.task_topic
          where archived_at is null order by created_at`,
      );
      const cards = await tx.unsafe<Record<string, unknown>>(
        `${CARD_ROWS}
          where t.archived_at is ${opts.archived ? "not null" : "null"}
          order by t.position, t.created_at`,
      );
      return {
        columns: columns.map((c) => ({
          id: String(c.id), name: String(c.name),
          tone: c.tone as TaskColumnTone, position: Number(c.position),
        })),
        topics: topics.map((t) => ({ id: String(t.id), name: String(t.name) })),
        tasks: cards.map(toCard),
      };
    });
  }

  async function detail(identity: Identity, id: string): Promise<TaskDetailRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${CARD_ROWS} where t.id = $1`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
      const body = await tx.unsafe<Record<string, unknown>>(
        `select description from echo.task where id = $1`, [id],
      );
      const checklist = await tx.unsafe<Record<string, unknown>>(
        `select id, label, done, position from echo.task_checklist_item
          where task_id = $1 order by position, created_at`, [id],
      );
      const comments = await tx.unsafe<Record<string, unknown>>(
        `select id, body, created_by, created_at from echo.task_comment
          where task_id = $1 order by created_at`, [id],
      );
      const eventRows = await tx.unsafe<Record<string, unknown>>(
        `select id, kind, actor_id, detail, created_at
           from echo.task_event where task_id = $1
          order by created_at desc limit 200`,
        [id],
      );
      return {
        ...toCard(rows[0]),
        events: eventRows.map((r) => ({
          id: String(r.id),
          kind: r.kind as TaskEventKind,
          actor_id: String(r.actor_id),
          detail: (r.detail as Record<string, string>) ?? {},
          created_at: iso(r.created_at),
        })),
        description: String(body[0]?.description ?? ""),
        checklist: checklist.map((i) => ({
          id: String(i.id), label: String(i.label),
          done: Boolean(i.done), position: Number(i.position),
        })),
        comments: comments.map((c) => ({
          id: String(c.id), body: String(c.body),
          created_by: String(c.created_by), created_at: iso(c.created_at),
        })),
      };
    });
  }

  async function create(identity: Identity, input: {
    title: unknown; column_id?: unknown; topic_id?: unknown; call_id?: unknown;
    description?: unknown; priority?: unknown; due_at?: unknown;
  }): Promise<TaskDetailRecord> {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title === "" || title.length > 300) {
      throw new ValidationError("a task needs a title", { code: "task_title_invalid" });
    }
    const priority = input.priority === undefined ? "medium" : parsePriority(input.priority);
    const due = parseDue(input.due_at);
    const id = await db.withIdentity(identity, async (tx: SqlTx) => {
      let columnId = typeof input.column_id === "string" && input.column_id !== ""
        ? input.column_id : null;
      if (columnId === null) {
        const first = await tx.unsafe<Record<string, unknown>>(
          `select id from echo.task_column where archived_at is null
            order by position, created_at limit 1`,
        );
        if (!first[0]) throw new ValidationError("the board has no columns", { code: "task_no_columns" });
        columnId = String(first[0].id);
      }
      /* new cards land at the top of the column, which is where a person
         looks for the thing they just made */
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task (org_id, column_id, topic_id, call_id, title,
                                description, priority, due_at, position, created_by)
         values (echo.actor_org_id(), $1, $2, $3, $4, $5, $6, $7,
                 coalesce((select min(position) from echo.task
                            where column_id = $1 and archived_at is null), 1) - 1,
                 echo.actor_id())
         returning id`,
        [
          columnId,
          typeof input.topic_id === "string" && input.topic_id !== "" ? input.topic_id : null,
          typeof input.call_id === "string" && input.call_id !== "" ? input.call_id : null,
          title,
          typeof input.description === "string" ? input.description : "",
          priority,
          due,
        ],
      );
      if (!rows[0]) throw new NotFoundError();
      await note(tx, String(rows[0].id), "created");
      return String(rows[0].id);
    });
    return detail(identity, id);
  }

  async function update(identity: Identity, id: string, patch: Record<string, unknown>): Promise<TaskDetailRecord> {
    const sets: string[] = [];
    const args: unknown[] = [id];
    const put = (sql: string, value: unknown) => {
      args.push(value);
      sets.push(`${sql} = $${args.length}`);
    };
    if ("title" in patch) {
      const title = typeof patch.title === "string" ? patch.title.trim() : "";
      if (title === "" || title.length > 300) {
        throw new ValidationError("a task needs a title", { code: "task_title_invalid" });
      }
      put("title", title);
    }
    if ("description" in patch) put("description", typeof patch.description === "string" ? patch.description : "");
    if ("priority" in patch) put("priority", parsePriority(patch.priority));
    if ("due_at" in patch) put("due_at", parseDue(patch.due_at));
    if ("column_id" in patch) {
      if (typeof patch.column_id !== "string" || patch.column_id === "") {
        throw new ValidationError("unknown column", { code: "task_column_unknown" });
      }
      put("column_id", patch.column_id);
    }
    if ("topic_id" in patch) {
      put("topic_id", typeof patch.topic_id === "string" && patch.topic_id !== "" ? patch.topic_id : null);
    }
    if ("position" in patch) {
      const position = Number(patch.position);
      if (!Number.isFinite(position)) {
        throw new ValidationError("unreadable position", { code: "task_position_invalid" });
      }
      put("position", position);
    }
    if ("labels" in patch) {
      const labels = Array.isArray(patch.labels)
        ? patch.labels.filter((l): l is string => typeof l === "string" && l.trim() !== "").slice(0, 12)
        : [];
      put("labels", labels);
    }
    /* the checkbox: done is a STATE stamp, not a column move — the
       reference keeps them independent and so do we */
    if ("done" in patch) {
      sets.push(patch.done === true ? "done_at = coalesce(done_at, now())" : "done_at = null");
    }
    if ("archived" in patch) {
      sets.push(patch.archived === true ? "archived_at = coalesce(archived_at, now())" : "archived_at = null");
    }
    if (sets.length === 0) {
      throw new ValidationError("nothing to change", { code: "task_patch_empty" });
    }
    sets.push("updated_at = now()");
    await db.withIdentity(identity, async (tx: SqlTx) => {
      /* the BEFORE state, read inside the same transaction: a history entry
         that says "moved" must know which column it left, and the update
         has already forgotten by the time it returns */
      const before = await tx.unsafe<Record<string, unknown>>(
        `select t.title, t.priority, t.done_at, t.archived_at, t.due_at,
                c.name as column_name
           from echo.task t
           left join echo.task_column c on c.id = t.column_id
          where t.id = $1`,
        [id],
      );
      if (!before[0]) throw new NotFoundError();
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.task set ${sets.join(", ")} where id = $1 returning id`, args,
      );
      if (!rows[0]) throw new NotFoundError();

      const was = before[0];
      if ("done" in patch && (patch.done === true) !== (was.done_at !== null)) {
        await note(tx, id, patch.done === true ? "done" : "undone");
      }
      if ("archived" in patch && (patch.archived === true) !== (was.archived_at !== null)) {
        await note(tx, id, patch.archived === true ? "archived" : "restored");
      }
      if ("column_id" in patch) {
        const to = await tx.unsafe<Record<string, unknown>>(
          `select name from echo.task_column where id = $1`, [patch.column_id],
        );
        if (to[0] && String(to[0].name) !== String(was.column_name ?? "")) {
          await note(tx, id, "moved", {
            from: String(was.column_name ?? ""), to: String(to[0].name),
          });
        }
      }
      if ("title" in patch && typeof patch.title === "string"
          && patch.title.trim() !== String(was.title)) {
        await note(tx, id, "renamed", { from: String(was.title) });
      }
      if ("priority" in patch && String(patch.priority) !== String(was.priority)) {
        await note(tx, id, "priority", {
          from: String(was.priority), to: String(patch.priority),
        });
      }
      if ("due_at" in patch) {
        const now = parseDue(patch.due_at);
        const then = was.due_at === null || was.due_at === undefined ? null : "set";
        if (now === null && then !== null) await note(tx, id, "due_cleared");
        else if (now !== null) await note(tx, id, "due_set", { at: now });
      }
    });
    return detail(identity, id);
  }

  async function addChecklistItem(identity: Identity, taskId: string, label: unknown): Promise<TaskChecklistItemRecord> {
    const text = typeof label === "string" ? label.trim() : "";
    if (text === "" || text.length > 500) {
      throw new ValidationError("a checklist line needs words", { code: "task_checklist_invalid" });
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task_checklist_item (task_id, org_id, label, position)
         select t.id, t.org_id, $2,
                coalesce((select max(position) from echo.task_checklist_item where task_id = $1), 0) + 1
           from echo.task t where t.id = $1
         returning id, label, done, position`,
        [taskId, text],
      );
      if (!rows[0]) throw new NotFoundError();
      return {
        id: String(rows[0].id), label: String(rows[0].label),
        done: Boolean(rows[0].done), position: Number(rows[0].position),
      };
    });
  }

  async function updateChecklistItem(identity: Identity, itemId: string, patch: { label?: unknown; done?: unknown }): Promise<void> {
    const sets: string[] = [];
    const args: unknown[] = [itemId];
    if ("label" in patch) {
      const text = typeof patch.label === "string" ? patch.label.trim() : "";
      if (text === "" || text.length > 500) {
        throw new ValidationError("a checklist line needs words", { code: "task_checklist_invalid" });
      }
      args.push(text);
      sets.push(`label = $${args.length}`);
    }
    if ("done" in patch) {
      args.push(patch.done === true);
      sets.push(`done = $${args.length}`);
    }
    if (sets.length === 0) throw new ValidationError("nothing to change", { code: "task_patch_empty" });
    await db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.task_checklist_item set ${sets.join(", ")} where id = $1 returning id`, args,
      );
      if (!rows[0]) throw new NotFoundError();
    });
  }

  async function deleteChecklistItem(identity: Identity, itemId: string): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      await tx.unsafe(`delete from echo.task_checklist_item where id = $1`, [itemId]);
    });
  }

  async function addComment(identity: Identity, taskId: string, body: unknown): Promise<TaskCommentRecord> {
    const text = typeof body === "string" ? body.trim() : "";
    if (text === "" || text.length > 4000) {
      throw new ValidationError("a comment needs words", { code: "task_comment_invalid" });
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task_comment (task_id, org_id, body, created_by)
         select t.id, t.org_id, $2, echo.actor_id()
           from echo.task t where t.id = $1
         returning id, body, created_by, created_at`,
        [taskId, text],
      );
      if (!rows[0]) throw new NotFoundError();
      return {
        id: String(rows[0].id), body: String(rows[0].body),
        created_by: String(rows[0].created_by), created_at: iso(rows[0].created_at),
      };
    });
  }

  async function setAssignedWithNote(identity: Identity, taskId: string, userId: string, on: boolean): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (on) {
        await tx.unsafe(
          `insert into echo.task_assignee (task_id, user_id, org_id)
           select t.id, $2, t.org_id from echo.task t where t.id = $1
           on conflict do nothing`,
          [taskId, userId],
        );
      } else {
        await tx.unsafe(
          `delete from echo.task_assignee where task_id = $1 and user_id = $2`,
          [taskId, userId],
        );
      }
      /* the NAME, not the id: a history row a person reads should say who,
         and an id is not a who. Names only — never an email. */
      const who = await tx.unsafe<Record<string, unknown>>(
        `select display_name from echo.app_user where id = $1`, [userId],
      );
      await note(tx, taskId, on ? "assigned" : "unassigned",
        { person: String(who[0]?.display_name ?? "") });
    });
  }

  async function createColumn(identity: Identity, name: unknown): Promise<TaskColumnRecord> {
    const text = typeof name === "string" ? name.trim() : "";
    if (text === "" || text.length > 80) {
      throw new ValidationError("a column needs a name", { code: "task_column_invalid" });
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task_column (org_id, name, tone, position, created_by)
         values (echo.actor_org_id(), $1, 'grey',
                 coalesce((select max(position) from echo.task_column where archived_at is null), 0) + 1,
                 echo.actor_id())
         returning id, name, tone, position`,
        [text],
      );
      if (!rows[0]) throw new NotFoundError();
      return {
        id: String(rows[0].id), name: String(rows[0].name),
        tone: rows[0].tone as TaskColumnTone, position: Number(rows[0].position),
      };
    });
  }

  async function updateColumn(
    identity: Identity, id: string,
    patch: { name?: unknown; archived?: unknown; tone?: unknown; position?: unknown },
  ): Promise<void> {
    const sets: string[] = [];
    const args: unknown[] = [id];
    if ("name" in patch) {
      const text = typeof patch.name === "string" ? patch.name.trim() : "";
      if (text === "" || text.length > 80) {
        throw new ValidationError("a column needs a name", { code: "task_column_invalid" });
      }
      args.push(text);
      sets.push(`name = $${args.length}`);
    }
    if ("tone" in patch) {
      if (typeof patch.tone !== "string"
          || !(TASK_COLUMN_TONES as readonly string[]).includes(patch.tone)) {
        throw new ValidationError("unknown column tone", { code: "task_column_tone_unknown" });
      }
      args.push(patch.tone);
      sets.push(`tone = $${args.length}`);
    }
    if ("position" in patch) {
      const position = Number(patch.position);
      if (!Number.isFinite(position)) {
        throw new ValidationError("unreadable position", { code: "task_position_invalid" });
      }
      args.push(position);
      sets.push(`position = $${args.length}`);
    }
    if ("archived" in patch) {
      /* archiving a column strands its cards behind an invisible wall — so
         the cards go with it, visibly, into the archive view */
      sets.push(patch.archived === true ? "archived_at = coalesce(archived_at, now())" : "archived_at = null");
    }
    if (sets.length === 0) throw new ValidationError("nothing to change", { code: "task_patch_empty" });
    await db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.task_column set ${sets.join(", ")} where id = $1 returning id`, args,
      );
      if (!rows[0]) throw new NotFoundError();
      if (patch.archived === true) {
        await tx.unsafe(
          `update echo.task set archived_at = coalesce(archived_at, now())
            where column_id = $1 and archived_at is null`, [id],
        );
      }
    });
  }

  async function createTopic(identity: Identity, name: unknown): Promise<TaskTopicRecord> {
    const text = typeof name === "string" ? name.trim() : "";
    if (text === "" || text.length > 80) {
      throw new ValidationError("a topic needs a name", { code: "task_topic_invalid" });
    }
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task_topic (org_id, name, created_by)
         values (echo.actor_org_id(), $1, echo.actor_id())
         returning id, name`,
        [text],
      );
      if (!rows[0]) throw new NotFoundError();
      return { id: String(rows[0].id), name: String(rows[0].name) };
    });
  }

  /**
   * Rename or retire a topic — the meetings twin, field for field (user
   * directive, 2026-09-02: "the added sub menu should have edit and delete
   * option, fix it both in tasks and meetings").
   *
   * ARCHIVED, never deleted: the cards in a topic are re-pointed to
   * no-folder by the schema, and a folder that vanished would take the
   * answer to "where did that go" with it.
   */
  async function updateTopic(
    identity: Identity, id: string, patch: { name?: string; archived?: boolean },
  ): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (typeof patch.name === "string") {
        const clean = patch.name.trim().slice(0, 80);
        if (clean === "") {
          throw new ValidationError("a topic needs a name", { code: "task_topic_invalid" });
        }
        await tx.unsafe("update echo.task_topic set name = $2 where id = $1", [id, clean]);
      }
      if (typeof patch.archived === "boolean") {
        await tx.unsafe(
          "update echo.task_topic set archived_at = $2 where id = $1",
          [id, patch.archived ? new Date().toISOString() : null],
        );
      }
    });
  }


  /**
   * ONE writer for the history (0147). It takes the TX, never a Db: an entry
   * written in its own transaction can record a move that failed or miss one
   * that succeeded — a history that disagrees with the board while looking
   * authoritative. Detail carries codes and NAMES only.
   */
  async function note(
    tx: SqlTx, taskId: string, kind: TaskEventKind, detail: Record<string, string> = {},
  ): Promise<void> {
    await tx.unsafe(
      `insert into echo.task_event (task_id, org_id, actor_id, kind, detail)
       select $1, t.org_id, echo.actor_id(), $2, $3::text::jsonb
         from echo.task t where t.id = $1`,
      [taskId, kind, JSON.stringify(detail)],
    );
  }

  /** the org roster for the assignee picker — names and role, nothing else */
  async function people(identity: Identity): Promise<OrgPersonRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, display_name, display_name_en, role
           from echo.app_user
          where org_id = echo.actor_org_id() and status = 'active'
          order by display_name`,
      );
      return rows.map((r) => ({
        id: String(r.id),
        display_name: String(r.display_name ?? ""),
        display_name_en: (r.display_name_en as string | null) ?? null,
        role: String(r.role ?? "member"),
      }));
    });
  }

  async function labels(identity: Identity): Promise<TaskLabelRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, name, color from echo.task_label order by created_at`,
      );
      return rows.map((r) => ({
        id: String(r.id), name: String(r.name), color: r.color as TaskLabelColor,
      }));
    });
  }

  function parseColor(value: unknown): TaskLabelColor {
    if (typeof value === "string" && (TASK_LABEL_COLORS as readonly string[]).includes(value)) {
      return value as TaskLabelColor;
    }
    throw new ValidationError("unknown label colour", { code: "task_label_color_unknown" });
  }

  async function createLabel(identity: Identity, name: unknown, color: unknown): Promise<TaskLabelRecord> {
    const text = typeof name === "string" ? name.trim() : "";
    if (text === "" || text.length > 40) {
      throw new ValidationError("a label needs a name", { code: "task_label_invalid" });
    }
    const tone = color === undefined ? "grey" : parseColor(color);
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.task_label (org_id, name, color, created_by)
         values (echo.actor_org_id(), $1, $2, echo.actor_id())
         returning id, name, color`,
        [text, tone],
      );
      if (!rows[0]) throw new NotFoundError();
      return {
        id: String(rows[0].id), name: String(rows[0].name),
        color: rows[0].color as TaskLabelColor,
      };
    });
  }

  async function updateLabel(
    identity: Identity, id: string, patch: { name?: unknown; color?: unknown },
  ): Promise<void> {
    const sets: string[] = [];
    const args: unknown[] = [id];
    if ("name" in patch) {
      const text = typeof patch.name === "string" ? patch.name.trim() : "";
      if (text === "" || text.length > 40) {
        throw new ValidationError("a label needs a name", { code: "task_label_invalid" });
      }
      args.push(text);
      sets.push(`name = $${args.length}`);
    }
    if ("color" in patch) {
      args.push(parseColor(patch.color));
      sets.push(`color = $${args.length}`);
    }
    if (sets.length === 0) {
      throw new ValidationError("nothing to change", { code: "task_patch_empty" });
    }
    await db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.task_label set ${sets.join(", ")} where id = $1 returning id`, args,
      );
      if (!rows[0]) throw new NotFoundError();
    });
  }

  /** retiring a label takes it off every card it was on, in one transaction */
  async function deleteLabel(identity: Identity, id: string): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      await tx.unsafe(`delete from echo.task_label_link where label_id = $1`, [id]);
      const rows = await tx.unsafe<Record<string, unknown>>(
        `delete from echo.task_label where id = $1 returning id`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
    });
  }

  /** a card wears a label, or stops wearing it — with its history entry */
  async function setLabel(
    identity: Identity, taskId: string, labelId: string, on: boolean,
  ): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      const label = await tx.unsafe<Record<string, unknown>>(
        `select name from echo.task_label where id = $1`, [labelId],
      );
      if (!label[0]) throw new NotFoundError();
      if (on) {
        await tx.unsafe(
          `insert into echo.task_label_link (task_id, label_id, org_id)
           select t.id, $2, t.org_id from echo.task t where t.id = $1
           on conflict do nothing`,
          [taskId, labelId],
        );
      } else {
        await tx.unsafe(
          `delete from echo.task_label_link where task_id = $1 and label_id = $2`,
          [taskId, labelId],
        );
      }
      await note(tx, taskId, on ? "label_added" : "label_removed",
        { label: String(label[0].name) });
    });
  }

  async function events(identity: Identity, taskId: string): Promise<TaskEventRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select id, kind, actor_id, detail, created_at
           from echo.task_event where task_id = $1
          order by created_at desc limit 200`,
        [taskId],
      );
      return rows.map((r) => ({
        id: String(r.id),
        kind: r.kind as TaskEventKind,
        actor_id: String(r.actor_id),
        detail: (r.detail as Record<string, string>) ?? {},
        created_at: iso(r.created_at),
      }));
    });
  }

  return {
    board, detail, create, update,
    addChecklistItem, updateChecklistItem, deleteChecklistItem,
    addComment, setAssigned: setAssignedWithNote, createColumn, updateColumn, createTopic, updateTopic,
    people, labels, createLabel, updateLabel, deleteLabel, setLabel, events,
  };
}
