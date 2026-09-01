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

export const TASK_COLUMN_TONES = ["grey", "blue", "amber", "green"] as const;
export type TaskColumnTone = (typeof TASK_COLUMN_TONES)[number];

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
         coalesce(asg.ids, '{}') as assignee_ids
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
    ) asg on true`;

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
      return {
        ...toCard(rows[0]),
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
      const rows = await tx.unsafe<Record<string, unknown>>(
        `update echo.task set ${sets.join(", ")} where id = $1 returning id`, args,
      );
      if (!rows[0]) throw new NotFoundError();
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

  async function setAssigned(identity: Identity, taskId: string, userId: string, on: boolean): Promise<void> {
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

  async function updateColumn(identity: Identity, id: string, patch: { name?: unknown; archived?: unknown }): Promise<void> {
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

  return {
    board, detail, create, update,
    addChecklistItem, updateChecklistItem, deleteChecklistItem,
    addComment, setAssigned, createColumn, updateColumn, createTopic,
  };
}
