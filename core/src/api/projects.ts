/**
 * 0181 — projects (user directive, 2026-09-04: "in the menu also add a new
 * section with the platform theme design, with a sub menu on top … the name
 * for the new item in the menu is projects").
 *
 * A project is a named piece of work with people on it, and it OWNS almost
 * nothing — see 0181's header for the argument. What that means here:
 *
 *   · CREATING A PROJECT CREATES ITS TASK CATEGORY, in the same transaction.
 *     The reference states this out loud on its own dialog, and it is the
 *     whole reason a project needs no task table: `task_topic.project_id`
 *     makes the category the project's presence on the board. One statement,
 *     so a project can never exist without the folder its cards go in.
 *   · RENAMING A PROJECT RENAMES THAT CATEGORY. Two names for one thing is
 *     two names that can disagree, and the one on the board is the one
 *     somebody files a card under.
 *   · The counts a card needs are read from the tasks under that category,
 *     never stored — a stored count is a number that goes wrong silently the
 *     first time a card is archived by another route.
 *
 * Everything runs as the CALLER through withIdentity; 0181's policies are the
 * wall and this file adds no second opinion about who may see what.
 */
import { NotFoundError, ValidationError } from "./errors.ts";
import {
  iso,
  PROJECT_PRIORITIES, PROJECT_STAGES,
  type ProjectPriority, type ProjectStage,
} from "./vocabulary.ts";
import { TASK_COLUMN_TONES, type TaskColumnTone } from "./tasks.ts";
import type { Db, SqlTx } from "../db/identity.ts";
import type { Identity } from "../agent/types.ts";

/** a project wears the board's tones — one closed set for the whole product */
export const PROJECT_TONES = TASK_COLUMN_TONES;
export type ProjectTone = TaskColumnTone;

export interface ProjectRecord {
  id: string;
  name: string;
  summary: string;
  tone: ProjectTone;
  /** an emoji, or nothing — the card falls back to the first letter */
  icon: string | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  /** the task category this project owns on the board (0181) */
  topic_id: string | null;
  member_ids: string[];
  /** live counts over that category — never stored */
  task_total: number;
  task_done: number;

  // ── 0208: the facts a project owns about itself ──────────────────────────
  stage: ProjectStage;
  priority: ProjectPriority;
  /** who is accountable — distinct from created_by, who typed the row */
  lead_id: string | null;
  /** a DAY, not an instant: a project has no clock time (0208) */
  starts_on: string | null;
  due_on: string | null;
  /**
   * The project's room, if it has one (0184's `chat_channel.project_id`).
   *
   * Read, never written here — the channel is the chat surface's to create,
   * and this is the pointer a project's own screen needs to offer the door.
   * A project with no room is the ordinary state, not a gap.
   */
  channel_id: string | null;
}

const MAX_NAME = 120;
const MAX_SUMMARY = 400;

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "" || name.length > MAX_NAME) {
    throw new ValidationError("a project needs a name", {
      code: "project_name_invalid",
      params: { max: String(MAX_NAME) },
    });
  }
  return name;
}

function cleanTone(value: unknown): ProjectTone {
  if (value === undefined || value === null) return "grey";
  if (typeof value !== "string" || !(PROJECT_TONES as readonly string[]).includes(value)) {
    /* the closed set is the schema's too — a refusal here and a 23514 there
       say the same sentence, and this one names the field */
    throw new ValidationError("unknown project tone", {
      code: "project_tone_invalid",
      params: { tones: PROJECT_TONES.join(", ") },
    });
  }
  return value as ProjectTone;
}

function cleanIcon(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const icon = typeof value === "string" ? value.trim() : "";
  /* an EMOJI, not an image: 0181 refuses a URL by length alone, and this
     refuses one by saying so */
  if (icon === "" || [...icon].length > 4) {
    throw new ValidationError("a project icon is one emoji", { code: "project_icon_invalid" });
  }
  return icon;
}

/**
 * The two closed sets, refused BY NAME (0208).
 *
 * One function for both, because they are the same shape and a second copy is
 * the one that stops matching. The refusal names the field and lists what is
 * allowed — a caller that sent «finished» learns what to send instead, and the
 * schema's 23514 says the same sentence one layer down.
 */
function cleanFromSet<T extends string>(
  value: unknown, allowed: readonly T[], field: string, fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`unknown project ${field}`, {
      code: `project_${field}_invalid`,
      params: { allowed: allowed.join(", ") },
    });
  }
  return value as T;
}

/**
 * A DAY, or nothing (0208).
 *
 * `YYYY-MM-DD` and nothing else: the column is a `date`, and accepting an
 * instant here would mean choosing a timezone to drop it into — which is the
 * pair of readings that moved a meeting by an offset on 2026-09-06. The
 * check is on the SHAPE and then on the calendar (`2026-02-31` matches the
 * pattern and is not a day), because a regex alone would let it through and
 * Postgres would refuse it as a 22008 nobody's screen explains.
 */
function cleanDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const day = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ValidationError(`${field} must be a day`, { code: `project_${field}_invalid` });
  }
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) {
    throw new ValidationError(`${field} is not a real day`, { code: `project_${field}_invalid` });
  }
  return day;
}

function cleanSummary(value: unknown): string {
  const summary = typeof value === "string" ? value.trim() : "";
  if (summary.length > MAX_SUMMARY) {
    throw new ValidationError("the summary is too long", {
      code: "project_summary_long",
      params: { max: String(MAX_SUMMARY) },
    });
  }
  return summary;
}

/**
 * One project per row, with everything a card renders.
 *
 * The counts come off the project's OWN category rather than off a
 * `project_id` on the task: a card is filed under a topic by the board, and
 * asking the task table about projects would be a second answer to "is this
 * card in that project" — the one the board never writes.
 */
const PROJECT_ROWS = `
  select p.id, p.name, p.summary, p.tone, p.icon, p.archived_at,
         p.created_by, p.created_at,
         p.stage, p.priority, p.lead_id, p.starts_on, p.due_on,
         tt.id as topic_id,
         ch.id as channel_id,
         coalesce(mem.ids, '{}') as member_ids,
         coalesce(cnt.total, 0) as task_total,
         coalesce(cnt.done, 0) as task_done
    from echo.project p
    left join echo.task_topic tt
      on tt.project_id = p.id and tt.archived_at is null
    /* the project's room (0184), read under the CALLER — a channel they may
       not read comes back null, which is the same answer as "no room" and is
       the right one: the door this pointer opens would refuse them anyway */
    left join echo.chat_channel ch
      on ch.project_id = p.id and ch.archived_at is null
    left join lateral (
      select array_agg(m.user_id) as ids
        from echo.project_member m where m.project_id = p.id
    ) mem on true
    left join lateral (
      select count(*) as total, count(*) filter (where t.done_at is not null) as done
        from echo.task t
       where t.topic_id = tt.id and t.archived_at is null
    ) cnt on true`;

function toProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    summary: String(row.summary ?? ""),
    tone: row.tone as ProjectTone,
    icon: (row.icon as string | null) ?? null,
    archived_at: row.archived_at === null || row.archived_at === undefined
      ? null
      : iso(row.archived_at),
    created_by: String(row.created_by),
    created_at: iso(row.created_at),
    topic_id: (row.topic_id as string | null) ?? null,
    member_ids: ((row.member_ids as string[] | null) ?? []).map(String),
    task_total: Number(row.task_total ?? 0),
    task_done: Number(row.task_done ?? 0),
    stage: row.stage as ProjectStage,
    priority: row.priority as ProjectPriority,
    lead_id: (row.lead_id as string | null) ?? null,
    /* a `date` column comes back as a JS Date from the driver and as a string
       from a text cast, and the wire promises ONE shape — `YYYY-MM-DD`, the
       day the column holds, with no zone to render it in */
    starts_on: day(row.starts_on),
    due_on: day(row.due_on),
    channel_id: (row.channel_id as string | null) ?? null,
  };
}

/** a `date` as the wire spells it, whichever way the driver handed it over */
function day(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    /* the column is a DAY with no zone; `toISOString` would first move it
       into UTC, which on a machine east of Greenwich hands back yesterday */
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/**
 * WHO DID WHAT, AND WHO DIDN'T (0186) — one row per person the project's work
 * touches, plus the bucket for work nobody was given.
 *
 * Counted, never stored. A project's numbers change every time anybody ticks
 * a box on the board, and a maintained tally would be a second copy going
 * stale between two screens that are supposed to agree.
 */
export interface ProjectWorkloadRow {
  /** null is the UNASSIGNED bucket — "who didn't" includes "nobody was
      given this", which is the reading a project's owner most needs and the
      one an inner join silently drops */
  user_id: string | null;
  assigned: number;
  done: number;
  open: number;
  /** open AND past its due date — a subset of `open`, not a fourth state */
  overdue: number;
}

export function createProjectsRepo(db: Db) {
  async function list(
    identity: Identity,
    opts: { archived?: boolean } = {},
  ): Promise<ProjectRecord[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${PROJECT_ROWS}
          where p.archived_at is ${opts.archived ? "not null" : "null"}
          order by p.created_at desc`,
      );
      return rows.map(toProject);
    });
  }

  async function detail(identity: Identity, id: string): Promise<ProjectRecord> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${PROJECT_ROWS} where p.id = $1`, [id],
      );
      if (!rows[0]) throw new NotFoundError();
      return toProject(rows[0]);
    });
  }

  async function create(
    identity: Identity,
    input: {
      name?: unknown; summary?: unknown; tone?: unknown;
      icon?: unknown; member_ids?: unknown;
      stage?: unknown; priority?: unknown; lead_id?: unknown;
      starts_on?: unknown; due_on?: unknown;
    },
  ): Promise<ProjectRecord> {
    const name = cleanName(input.name);
    const summary = cleanSummary(input.summary);
    const tone = cleanTone(input.tone);
    const icon = cleanIcon(input.icon);
    /* the 0208 fields are OPTIONAL on create and each falls back to the
       column's own default — a create dialog that asks for five more answers
       before a project can exist is a form people stop finishing */
    const stage = cleanFromSet(input.stage, PROJECT_STAGES, "stage", "active");
    const priority = cleanFromSet(input.priority, PROJECT_PRIORITIES, "priority", "medium");
    const leadId = typeof input.lead_id === "string" && input.lead_id !== "" ? input.lead_id : null;
    const startsOn = cleanDay(input.starts_on, "starts_on");
    const dueOn = cleanDay(input.due_on, "due_on");
    const invited = Array.isArray(input.member_ids)
      ? input.member_ids.filter((v): v is string => typeof v === "string" && v !== "")
      : [];

    return db.withIdentity(identity, async (tx: SqlTx) => {
      const created = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.project
           (org_id, name, summary, tone, icon, created_by,
            stage, priority, lead_id, starts_on, due_on)
         values (echo.actor_org_id(), $1, $2, $3, $4, echo.actor_id(),
                 $5, $6, $7, $8::date, $9::date)
         returning id`,
        [name, summary, tone, icon, stage, priority, leadId, startsOn, dueOn],
      );
      const id = String(created[0]!.id);

      /* THE CATEGORY, in the same statement-run as the project. A project
         whose folder failed to appear is a project whose cards have nowhere
         to go, and the person who created it would have no way to tell. */
      await tx.unsafe(
        `insert into echo.task_topic (org_id, name, project_id, created_by)
         values (echo.actor_org_id(), $1, $2, echo.actor_id())`,
        [name, id],
      );

      /* the creator is a member, always and first: a project you made and
         are not on reads as somebody else's, and the dialog's picker is for
         adding COLLEAGUES */
      const members = new Set<string>([identity.userId, ...invited]);
      for (const userId of members) {
        await tx.unsafe(
          `insert into echo.project_member (project_id, user_id, org_id, added_by)
           values ($1, $2, echo.actor_org_id(), echo.actor_id())
           on conflict do nothing`,
          [id, userId],
        );
      }

      const rows = await tx.unsafe<Record<string, unknown>>(
        `${PROJECT_ROWS} where p.id = $1`, [id],
      );
      return toProject(rows[0]!);
    });
  }

  async function update(
    identity: Identity,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ProjectRecord> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const put = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    let renamed: string | null = null;
    if ("name" in patch) {
      renamed = cleanName(patch.name);
      put("name", renamed);
    }
    if ("summary" in patch) put("summary", cleanSummary(patch.summary));
    if ("tone" in patch) put("tone", cleanTone(patch.tone));
    if ("icon" in patch) put("icon", cleanIcon(patch.icon));

    /* 0208. OMIT-LEAVES / NULL-CLEARS, the contract this product already has
       at /v1/me and on the org form: `"lead_id" in patch` is the supplied
       signal, and a null inside it genuinely clears the field. Reading
       `patch.lead_id ?? undefined` instead would make "nobody leads this any
       more" indistinguishable from "the form did not mention a lead", which
       is the interaction where a save button does nothing. */
    if ("stage" in patch) {
      put("stage", cleanFromSet(patch.stage, PROJECT_STAGES, "stage", "active"));
    }
    if ("priority" in patch) {
      put("priority", cleanFromSet(patch.priority, PROJECT_PRIORITIES, "priority", "medium"));
    }
    if ("lead_id" in patch) {
      put("lead_id", typeof patch.lead_id === "string" && patch.lead_id !== ""
        ? patch.lead_id
        : null);
    }
    if ("starts_on" in patch) {
      values.push(cleanDay(patch.starts_on, "starts_on"));
      sets.push(`starts_on = $${values.length}::date`);
    }
    if ("due_on" in patch) {
      values.push(cleanDay(patch.due_on, "due_on"));
      sets.push(`due_on = $${values.length}::date`);
    }
    /* ARCHIVED, not deleted: 0181 grants nobody DELETE on a project, and the
       api must not be the place that pretends otherwise */
    if ("archived" in patch) put("archived_at", patch.archived === true ? new Date() : null);
    if (sets.length === 0) return detail(identity, id);
    sets.push("updated_at = now()");

    return db.withIdentity(identity, async (tx: SqlTx) => {
      const done = await tx.unsafe<Record<string, unknown>>(
        `update echo.project set ${sets.join(", ")} where id = $1 returning id`,
        values,
      );
      if (!done[0]) throw new NotFoundError();
      if (renamed !== null) {
        /* the board's folder carries the project's name — see the header.
           Nothing here checks a row came back: a project with no category is
           a state 0181 does not create, and a repair that invents one would
           hide the day it happened. */
        await tx.unsafe(
          `update echo.task_topic set name = $2 where project_id = $1`,
          [id, renamed],
        );
      }
      const rows = await tx.unsafe<Record<string, unknown>>(
        `${PROJECT_ROWS} where p.id = $1`, [id],
      );
      return toProject(rows[0]!);
    });
  }

  /** add or remove one person. Idempotent both ways — a picker double-click
      is not an error, and neither is un-adding somebody already gone. */
  async function setMember(
    identity: Identity,
    id: string,
    userId: string,
    on: boolean,
  ): Promise<void> {
    await db.withIdentity(identity, async (tx: SqlTx) => {
      if (on) {
        await tx.unsafe(
          `insert into echo.project_member (project_id, user_id, org_id, added_by)
           values ($1, $2, echo.actor_org_id(), echo.actor_id())
           on conflict do nothing`,
          [id, userId],
        );
      } else {
        await tx.unsafe(
          `delete from echo.project_member where project_id = $1 and user_id = $2`,
          [id, userId],
        );
      }
    });
  }

  /**
   * The project's work, by person.
   *
   * A task with two people on it counts for BOTH: the question is "what is
   * this person carrying", not "how do we divide one card between them", and
   * a fractional card is a number nobody can act on.
   */
  async function workload(identity: Identity, id: string): Promise<ProjectWorkloadRow[]> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const rows = await tx.unsafe<Record<string, unknown>>(
        `select a.user_id,
                count(*)::int as assigned,
                count(*) filter (where t.done_at is not null)::int as done,
                count(*) filter (where t.done_at is null)::int as open,
                count(*) filter (where t.done_at is null
                                   and t.due_at is not null
                                   and t.due_at < now())::int as overdue
           from echo.task t
           join echo.task_topic tt on tt.id = t.topic_id and tt.project_id = $1
           /* LEFT, and that is the whole point: the row with a null user is
              the work nobody was given, which an inner join would hide at
              exactly the moment somebody is looking for it */
           left join echo.task_assignee a on a.task_id = t.id
          where t.archived_at is null
          group by a.user_id`,
        [id],
      );
      return rows.map((r) => ({
        user_id: (r.user_id as string | null) ?? null,
        assigned: Number(r.assigned ?? 0),
        done: Number(r.done ?? 0),
        open: Number(r.open ?? 0),
        overdue: Number(r.overdue ?? 0),
      }));
    });
  }

  /**
   * Delete one (0191).
   *
   * A DELETE and not a soft one, because "archive" already exists beside it
   * and a product with two words for the same act has one of them lying. What
   * goes is the project row and its membership; what stays is the WORK — the
   * board keeps the category as an ordinary folder and the room keeps its
   * conversation, both by `on delete set null (project_id)` rather than by
   * anything this function does. A folder full of cards must not disappear
   * because its label did.
   *
   * `returning id` is how a refusal is told from a miss: RLS filters a DELETE
   * to zero rows rather than raising, so without this a member's forbidden
   * delete and an id that never existed would both answer 204.
   */
  async function remove(identity: Identity, id: string): Promise<void> {
    return db.withIdentity(identity, async (tx: SqlTx) => {
      const gone = await tx.unsafe<Record<string, unknown>>(
        `delete from echo.project where id = $1 returning id`, [id],
      );
      if (!gone[0]) throw new NotFoundError();
    });
  }

  return { list, detail, create, update, setMember, workload, remove };
}

export type ProjectsRepo = ReturnType<typeof createProjectsRepo>;
