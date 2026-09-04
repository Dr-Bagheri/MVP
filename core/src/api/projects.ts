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
import { iso } from "./vocabulary.ts";
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
         tt.id as topic_id,
         coalesce(mem.ids, '{}') as member_ids,
         coalesce(cnt.total, 0) as task_total,
         coalesce(cnt.done, 0) as task_done
    from echo.project p
    left join echo.task_topic tt
      on tt.project_id = p.id and tt.archived_at is null
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
  };
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
    },
  ): Promise<ProjectRecord> {
    const name = cleanName(input.name);
    const summary = cleanSummary(input.summary);
    const tone = cleanTone(input.tone);
    const icon = cleanIcon(input.icon);
    const invited = Array.isArray(input.member_ids)
      ? input.member_ids.filter((v): v is string => typeof v === "string" && v !== "")
      : [];

    return db.withIdentity(identity, async (tx: SqlTx) => {
      const created = await tx.unsafe<Record<string, unknown>>(
        `insert into echo.project (org_id, name, summary, tone, icon, created_by)
         values (echo.actor_org_id(), $1, $2, $3, $4, echo.actor_id())
         returning id`,
        [name, summary, tone, icon],
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

  return { list, detail, create, update, setMember };
}

export type ProjectsRepo = ReturnType<typeof createProjectsRepo>;
