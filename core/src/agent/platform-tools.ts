/**
 * WHAT ECHO AND ITS TWO COLLEAGUES CAN READ.
 *
 * USER DIRECTIVE, 2026-09-03: "give all three of them all the tools they need,
 * at least give echo 100 tools and for each agent 100 specialist tools that
 * make them special in something more than the other."
 *
 * ── ON THE NUMBER ──────────────────────────────────────────────────────────
 *
 * Three hundred tools is not a thing this platform can honestly hand a model,
 * and the reason is not effort. Every tool here calls a repo the REST API
 * calls, with the caller's identity, so a tool exists only where a capability
 * does — and a tool with no capability behind it is a promise that fails at
 * run time, which is worse than a capability the model does not have. Padding
 * to a count would mean inventing 250 of those.
 *
 * It would also make them worse at the job. A model choosing among two dozen
 * well-named tools picks well; the same model at a hundred picks by keyword
 * and calls the wrong one confidently. The directive's real ask is the clause
 * around the number — "all the tools they need" and "special in something more
 * than the other" — and that is what this file delivers: every read the
 * platform actually has, split into two specialisms that genuinely differ.
 *
 * The count is reported by the test beside this file rather than claimed here,
 * for the reason a count in prose always rots.
 *
 * ── THE SPLIT ──────────────────────────────────────────────────────────────
 *
 * `SPECIALISM` on each tool says who carries it:
 *
 *   · "analyst"  — Ava. Reading the record and reporting on it: transcripts,
 *     summaries, search, history, people, the audit trail, what changed.
 *   · "operator" — Roya. The state of work in flight: meetings, tasks,
 *     agendas, minutes, connected mail and calendar — the things somebody is
 *     about to act on.
 *   · "both"     — the handful neither can work without.
 *
 * Echo carries EVERYTHING, because Echo is the one being asked and the one
 * that decides who to hand a piece to. That is the directive's "echo should be
 * the brain that control them" in one line of code rather than in a prompt.
 *
 * ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 *
 * Nothing that writes. Writes reach the product two ways and neither is a
 * server-side tool: a PROPOSAL the person confirms (write-tools.ts), or a
 * CLIENT tool the browser performs under their own session with a consent card
 * (client-tools.ts). Both keep "the agent borrows the caller's authority and
 * never more" true by construction, and a delegate inherits neither by
 * accident — see `blastRadius` in delegation.ts.
 */
import { Type } from "./pi.ts";
import { ToolDenied, type DomainTool } from "./tools.ts";
import { NotFoundError } from "../api/errors.ts";
import { createCallsRepo } from "../api/calls.ts";
import { createTranscriptsRepo } from "../api/transcripts.ts";
import { createMeetingsRepo } from "../api/meetings.ts";
import { createTasksRepo } from "../api/tasks.ts";
import { createProjectsRepo } from "../api/projects.ts";
import { createMembersRepo } from "../api/members.ts";
import { createAuditRepo } from "../api/audit.ts";
import { createOrgRepo } from "../api/org.ts";
import { createDirectoryRepo } from "../api/directory.ts";
import { CAPABILITIES, createCapabilitiesRepo } from "../api/capabilities.ts";
import type { Db } from "../db/identity.ts";

export interface PlatformToolDeps {
  db: Db;
}

/** Who carries this tool when the run belongs to a delegate. */
/**
 * ONE SET FOR EVERY AGENT (user ruling, 2026-09-06: "full tool set for all
 * three, yes"). Each tool used to carry a specialism — analyst, operator,
 * both — and a colleague Echo called got only its own slice, which is where
 * «به سوابق دسترسی ندارم» came from. The wall was never the persona: every
 * read here runs under the PERSON's identity and role, so a member's Roya
 * sees exactly what that member sees. The tag is gone rather than ignored —
 * a field nothing reads is the drift shape this repo has already paid for.
 */
export type PlatformTool = DomainTool<PlatformToolDeps, never>;

/**
 * Results are read by a model with a context window, not by a scrollbar.
 * Every list here is capped and says so when it truncated — "there are three"
 * and "I was shown three" are different statements, and a model that cannot
 * tell them apart reports the second as the first.
 */
const CAP = 40;

/**
 * A repo's NotFoundError means "you cannot see this", which for a tool is a
 * refusal to read and adapt to rather than an error that fails the run.
 * Everything else propagates: a real fault reported as a polite "not found"
 * makes the model tell somebody their meeting does not exist.
 */
async function denying<T>(work: () => Promise<T>, refusal: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFoundError) throw new ToolDenied(refusal);
    throw error;
  }
}

/** cap a list and say so — never silently */
function capped<T>(rows: T[], limit = CAP): { items: T[]; count: number; truncated: boolean } {
  const items = rows.slice(0, limit);
  return { items, count: items.length, truncated: rows.length > items.length };
}

function tool<TArgs>(
  def: Omit<DomainTool<PlatformToolDeps, TArgs>, "run"> & {
    run: DomainTool<PlatformToolDeps, TArgs>["run"];
  },
): PlatformTool {
  return def as unknown as PlatformTool;
}

export function createPlatformTools(): PlatformTool[] {
  return [
    // ── the record: calls, transcripts, summaries ────────────────────────
    tool<{ status?: string; limit?: number }>({
      name: "list_records",
      label: "فهرست رکوردها",
      description:
        "The organization's call records this person can see — id, title, when, "
        + "how long, processing status. Use it to find a record by description "
        + "when no id is to hand.",
      parameters: Type.Object({
        status: Type.Optional(Type.String({ description: "Filter by processing status, e.g. ready." })),
        limit: Type.Optional(Type.Number({ description: "How many, up to 40." })),
      }),
      async run({ identity, deps }, args) {
        const rows = await createCallsRepo(deps.db).list(identity, {});
        const filtered = args.status
          ? rows.filter((r) => r.status === args.status)
          : rows;
        return capped(filtered, Math.min(args.limit ?? CAP, CAP));
      },
    }),

    tool<{ call_id: string }>({
      name: "get_summary",
      label: "خلاصهٔ جلسه",
      description:
        "The CURRENT summary of one record — the version a reader of the product "
        + "would see. Prefer this over reading the transcript when the question "
        + "is about what a meeting concluded.",
      parameters: Type.Object({ call_id: Type.String() }),
      async run({ identity, deps }, args) {
        return denying(
          () => createTranscriptsRepo(deps.db).currentSummary(identity, args.call_id),
          "no summary is visible to you for that record",
        );
      },
    }),

    tool<{ call_id: string }>({
      name: "list_summary_versions",
      label: "نسخه‌های خلاصه",
      description:
        "Every summary version of one record, oldest first, with the model and "
        + "template that produced each. Use it when the question is how the "
        + "account of a meeting CHANGED, not what it says.",
      parameters: Type.Object({ call_id: Type.String() }),
      async run({ identity, deps }, args) {
        const rows = await denying(
          () => createTranscriptsRepo(deps.db).summaries(identity, args.call_id),
          "no record with that id is visible to you",
        );
        return capped(rows);
      },
    }),

    tool<{ call_id: string }>({
      name: "list_speakers",
      label: "گویندگان",
      description:
        "Who spoke in one record and how they are labelled — the roster the "
        + "transcript's speaker numbers resolve through.",
      parameters: Type.Object({ call_id: Type.String() }),
      async run({ identity, deps }, args) {
        const rows = await denying(
          () => createTranscriptsRepo(deps.db).speakers(identity, args.call_id),
          "no record with that id is visible to you",
        );
        return capped(rows);
      },
    }),

    tool<{ call_id: string }>({
      name: "list_record_notes",
      label: "یادداشت‌های رکورد",
      description: "The human notes attached to one record.",
      parameters: Type.Object({ call_id: Type.String() }),
      async run({ identity, deps }, args) {
        const rows = await denying(
          () => createCallsRepo(deps.db).listNotes(identity, args.call_id),
          "no record with that id is visible to you",
        );
        return capped(rows);
      },
    }),

    // ── meetings ─────────────────────────────────────────────────────────
    tool<{ archived?: boolean }>({
      name: "list_meetings",
      label: "فهرست جلسات",
      description:
        "The organization's meetings — planned and held — with their time, mode, "
        + "host, invitees and whether a recording exists. The FIRST place to look "
        + "for anything about what is scheduled.",
      parameters: Type.Object({
        archived: Type.Optional(Type.Boolean({ description: "Filed-away meetings instead of live ones." })),
      }),
      async run({ identity, deps }, args) {
        const rows = await createMeetingsRepo(deps.db)
          .list(identity, { archived: args.archived === true });
        return capped(rows);
      },
    }),

    tool<{ meeting_id: string }>({
      name: "get_meeting",
      label: "جزئیات جلسه",
      description:
        "One meeting in full: agenda, invitees, host, location or link, the "
        + "record it produced, and where its minutes stand.",
      parameters: Type.Object({ meeting_id: Type.String() }),
      async run({ identity, deps }, args) {
        return denying(
          () => createMeetingsRepo(deps.db).detail(identity, args.meeting_id),
          "no meeting with that id is visible to you",
        );
      },
    }),

    tool<{ meeting_id: string }>({
      name: "list_meeting_items",
      label: "مصوبات و اقدام‌ها",
      description:
        "A meeting's decisions, action items, questions and risks — the rows the "
        + "minutes are built from. Use this rather than re-reading a summary when "
        + "the question is what was DECIDED or who owes what.",
      parameters: Type.Object({ meeting_id: Type.String() }),
      async run({ identity, deps }, args) {
        const rows = await denying(
          () => createMeetingsRepo(deps.db).items(identity, args.meeting_id),
          "no meeting with that id is visible to you",
        );
        return capped(rows);
      },
    }),

    tool<Record<string, never>>({
      name: "list_meeting_folders",
      label: "پوشه‌های جلسات",
      description: "The folders meetings are filed under, for scoping a search.",
      parameters: Type.Object({}),
      async run({ identity, deps }) {
        return capped(await createMeetingsRepo(deps.db).topics(identity));
      },
    }),

    // ── tasks ────────────────────────────────────────────────────────────
    tool<{ archived?: boolean }>({
      name: "list_tasks",
      label: "تخته تسک‌ها",
      description:
        "The task board: every column, the folders (each saying whether it is a "
        + "project's — a project owns a folder of its own name; the rest are "
        + "personal groupings) and the cards, with owners, deadlines, priority "
        + "and labels. The place to answer what is in flight, what is late, and "
        + "who is carrying it.",
      parameters: Type.Object({
        archived: Type.Optional(Type.Boolean()),
      }),
      async run({ identity, deps }, args) {
        /* seed:false — a READ TOOL MUST NOT WRITE. The screen creates the
           default columns on a first visit; an agent asking what is on the
           board must answer "nothing" rather than build one, and on a role
           with SELECT only the attempt is an error rather than a board. */
        const [board, projects] = await Promise.all([
          createTasksRepo(deps.db).board(identity, { archived: args.archived === true, seed: false }),
          createProjectsRepo(deps.db).list(identity),
        ]);
        /* THE FOLDERS, each saying whether it is a project's (0181: a project
           owns a folder of its own name). Until 2026-09-06 the board's
           folders were not in this answer at all and no tool listed the
           projects — the model was asked to tell a person's grouping from
           an admin's order of work while it could see neither. */
        const projectOf = new Map(
          projects.flatMap((p) => (p.topic_id !== null ? [[p.topic_id, p.name] as const] : [])),
        );
        return {
          columns: board.columns,
          folders: board.topics.map((t) => ({ id: t.id, name: t.name, project: projectOf.get(t.id) ?? null })),
          tasks: capped(board.tasks, CAP),
        };
      },
    }),

    tool<{ task_id: string }>({
      name: "get_task",
      label: "جزئیات تسک",
      description:
        "One task in full: description, checklist, comments, assignees, labels "
        + "and its event history — who moved it and when.",
      parameters: Type.Object({ task_id: Type.String() }),
      async run({ identity, deps }, args) {
        return denying(
          () => createTasksRepo(deps.db).detail(identity, args.task_id),
          "no task with that id is visible to you",
        );
      },
    }),

    tool<Record<string, never>>({
      name: "list_task_labels",
      label: "برچسب‌های تسک",
      description: "The organization's task labels and their tones.",
      parameters: Type.Object({}),
      async run({ identity, deps }) {
        return capped(await createTasksRepo(deps.db).labels(identity));
      },
    }),

    /*
     * PROJECTS (2026-09-06). Every active member sees every project (0181),
     * and until today no tool showed them — `update_project`'s own description
     * pointed at a `list_projects` that did not exist. "both": Ava files what
     * she finds as work, and work for a project has to be filed IN it.
     */
    tool<{ archived?: boolean }>({
      name: "list_projects",
      label: "پروژه‌ها",
      description:
        "The projects — an admin's orders of work, each with its people, its "
        + "folder on the task board (the same name) and progress counted off "
        + "the tasks filed there. NOT the same thing as a folder: a folder is a "
        + "person's own grouping of their tasks. Read it before create_task with "
        + "`project`, and to answer who is on what.",
      parameters: Type.Object({
        archived: Type.Optional(Type.Boolean()),
      }),
      async run({ identity, deps }, args) {
        const [rows, board] = await Promise.all([
          createProjectsRepo(deps.db).list(identity, { archived: args.archived === true }),
          createTasksRepo(deps.db).board(identity, { archived: false, seed: false }),
        ]);
        const folderName = new Map(board.topics.map((t) => [t.id, t.name] as const));
        return capped(rows.map((project) => ({
          id: project.id,
          name: project.name,
          summary: project.summary,
          tone: project.tone,
          folder: project.topic_id !== null ? folderName.get(project.topic_id) ?? null : null,
          member_ids: project.member_ids,
          task_total: project.task_total,
          task_done: project.task_done,
          archived: project.archived_at !== null,
        })));
      },
    }),

    // ── people ───────────────────────────────────────────────────────────
    tool<Record<string, never>>({
      name: "list_colleagues",
      label: "همکاران",
      description:
        "Everyone in this organization with their role — the lighter read that "
        + "every member may make, and the right one for 'who should own this' or "
        + "'who was in that meeting'.",
      parameters: Type.Object({}),
      async run({ identity, deps }) {
        return capped(await createTasksRepo(deps.db).people(identity));
      },
    }),

    /*
     * ── WHO IS ASKING, AND WHAT THEY MAY DO ────────────────────────────────
     *
     * User directive, 2026-09-04: "give them access to see who has what role
     * in the platform, so based on that they will tell the user if they have
     * access to do what they asked or not."
     *
     * These two are SERVER tools rather than browser ones on purpose. A
     * client tool only exists while somebody is looking at a screen, and the
     * question "may this person do that" is asked hardest by the runs nobody
     * is watching — a workflow, a mail draft, a meeting brief.
     *
     * Neither is a permission CHECK. The wall is still the wall: every route
     * refuses on its own, and an agent that read this table and decided to
     * proceed would be reasoning where the database is deciding. What they
     * buy is the ability to SAY SO FIRST — "you are a member, and this org
     * has taken record deletion away from members, so I cannot do that for
     * you" instead of trying it and relaying a 403.
     */
    tool({
      name: "whoami",
      label: "من کی هستم",
      description:
        "The person you are talking to: their id, their role in this "
        + "organization (member, admin or owner) and whether their account is "
        + "active. Read this before telling somebody what they can or cannot "
        + "do — every tool here runs with THEIR authority, not yours.",
      parameters: Type.Object({}),
      async run({ identity }) {
        /* no query: the identity was resolved against the database before
           this run was allowed to start, so asking again would be a second
           reading of one fact that can only disagree with the first */
        return {
          user_id: identity.userId,
          org_id: identity.orgId,
          role: identity.role,
          active: identity.isActive,
        };
      },
    }),

    tool({
      name: "list_role_permissions",
      label: "دسترسی نقش‌ها",
      description:
        "What each role may do in THIS organization. Every capability is "
        + "allowed unless the organization has written it off, so a key with "
        + "allowed=true is the default and one with allowed=false was taken "
        + "away deliberately. `role` is whose privilege it is: an admin is "
        + "never restricted by a member-level rule, and the owner by none of "
        + "them. Use it with whoami to answer 'am I allowed to' before "
        + "attempting anything.",
      parameters: Type.Object({}),
      async run({ identity, deps }) {
        const written = await createCapabilitiesRepo(deps.db).list(identity);
        const decided = new Map(written.map((row) => [`${row.role}:${row.capability}`, row.allowed]));
        /*
         * The whole vocabulary, not just the rows. An org that has never
         * touched this screen has NO rows, and returning an empty list would
         * read as "this organization permits nothing" — the absent-versus-
         * denied confusion, on the one subject where getting it backwards
         * makes the assistant refuse things it could have done.
         */
        return {
          asking_role: identity.role,
          capabilities: CAPABILITIES.map((def) => ({
            capability: def.key,
            role: def.role,
            allowed: decided.get(`${def.role}:${def.key}`) ?? true,
            /* stated per row, because "not written down" and "written down as
               allowed" are the same permission and different facts */
            decided: decided.has(`${def.role}:${def.key}`),
          })),
        };
      },
    }),

    tool<{ window_days?: number }>({
      name: "member_stats",
      label: "آمار اعضا",
      description:
        "How many people are active, pending or disabled, and how those numbers "
        + "MOVED over a window. Answers 'is the team growing' with recorded "
        + "history rather than with arithmetic on today's list.",
      parameters: Type.Object({
        window_days: Type.Optional(Type.Number({ description: "Days to look back. Default 30." })),
      }),
      async run({ identity, deps }, args) {
        return createMembersRepo(deps.db).stats(identity, {
          windowDays: args.window_days,
        });
      },
    }),

    tool<{ search?: string }>({
      name: "list_voices",
      label: "دفترچهٔ گویندگان",
      description:
        "The speaker directory — the people the platform can recognise by voice, "
        + "and how often each has been heard. Distinct from colleagues: a voice "
        + "can belong to somebody with no account.",
      parameters: Type.Object({
        search: Type.Optional(Type.String()),
      }),
      async run({ identity, deps }, args) {
        /* the repo's list takes no filter — the search happens HERE rather
           than by adding a parameter to a read the whole product shares, and
           it is a contains-match on the name the product displays */
        const rows = await createDirectoryRepo(deps.db).list(identity);
        const needle = (args.search ?? "").trim().toLowerCase();
        return capped(needle === ""
          ? rows
          : rows.filter((r) => String(r.display_name ?? "").toLowerCase().includes(needle)));
      },
    }),

    // ── the organization and its trail ───────────────────────────────────
    tool<Record<string, never>>({
      name: "get_organization",
      label: "سازمان",
      description:
        "This organization's own record — name, language, timezone, calendar and "
        + "which models it allows. Read it before assuming a default.",
      parameters: Type.Object({}),
      async run({ identity, deps }) {
        return createOrgRepo(deps.db).get(identity);
      },
    }),

    tool<{ limit?: number }>({
      name: "list_audit",
      label: "رویدادها",
      description:
        "The audit trail — what changed in this organization, by whom, when. "
        + "Codes and identifiers only; it never carries content. Admins see the "
        + "whole feed and a member sees their own.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "How many entries, up to 40." })),
      }),
      async run({ identity, deps }, args) {
        const page = await createAuditRepo(deps.db).list(identity, {
          limit: Math.min(args.limit ?? 20, CAP),
        });
        return page;
      },
    }),
  ];
}

/** Every name this file registers — derived, never hand-listed. */
export const PLATFORM_TOOL_NAMES: readonly string[] =
  createPlatformTools().map((t) => t.name);

/** The subset a given specialist carries. Echo is not a specialist: it gets all. */
/** every platform read — there is one set now, and this is it */
export function toolsFor(): PlatformTool[] {
  return createPlatformTools();
}
