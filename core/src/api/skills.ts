/**
 * Skill authoring (M29, Part 2) — the management surface over echo.skill.
 *
 * The WALL was built two milestones ago and this module adds no authority to
 * it: db/0013's policies decide who writes (org rows: admins; user rows:
 * their owner; system rows: nobody), and every statement here runs as the
 * caller. What this layer adds is legible refusals — a member posting an
 * org-level skill gets a clean 403 with a sentence, not a bare 42501 — and
 * vocabulary validation, so a typo'd tool name is refused at the door
 * instead of silently never firing (rule 7: a model integration wired wrong
 * fails silently; a tool list is the same shape one row up).
 *
 * Delete does not exist, on purpose (db/0018): archiving frees the slug and
 * keeps the definition attached to the runs that used it (invariant 5).
 */
import { ConflictError, NotActivatedError, NotFoundError, ValidationError } from "./errors.ts";
import { firstServable } from "./models.ts";
import { iso, isoOrNull } from "./vocabulary.ts";
import { toJsonb, JSONB_PARAM } from "../db/jsonb.ts";
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { DOMAIN_TOOL_NAMES } from "../agent/domain-tools.ts";
import { CLIENT_TOOL_NAMES } from "../agent/client-tools.ts";
import { createWriteTools } from "../agent/write-tools.ts";
import { toolsFor } from "../agent/platform-tools.ts";
import type { Identity } from "../agent/types.ts";

/**
 * The tool vocabulary, derived from the REGISTRIES rather than hand-listed —
 * a guard's coverage list is itself a seam (the Role-drift lesson), and a
 * write tool added next milestone must become author-attachable without
 * anyone remembering this file exists.
 *
 * LAZY, not module-level: `createWriteTools()` builds TypeBox schemas, and
 * running that at import time crashed every suite that stubs the model
 * runtime — collection died before a single test ran. Deferring to first
 * use keeps the derivation and loses the load-time dependency.
 */
let cachedTools: readonly string[] | undefined;
export function availableTools(): readonly string[] {
  if (!cachedTools) {
    /*
     * THE PLATFORM READS BELONG HERE TOO (2026-09-04).
     *
     * This list is what `POST /v1/agents` validates a stored tool array
     * against, and it held seven names — the four domain reads plus the three
     * write proposals. So an organisation could not author an agent that
     * declares `list_meetings` or `list_tasks`: the tool existed, the run
     * offered it, and the form refused to say its name.
     *
     * Worse, db/0168 wrote `list_members` directly into both shipped agents'
     * rows — a value this very validator would have rejected had anybody sent
     * it through the door. A vocabulary narrower than the implementation is
     * the wiring seam one layer up, and it fails in the direction that looks
     * like a typo.
     *
     * Derived from the producers, never hand-enumerated: a guard's coverage
     * list is itself a seam, and this repo has already watched one drift with
     * a hole exactly where the break came.
     */
    /*
     * THE CLIENT TOOLS BELONG HERE TOO (user report, 2026-09-04: "update the
     * tools section in the agents page").
     *
     * The agent page reads this list to say what an assistant can do, and it
     * was showing twenty-four while the assistant actually held ninety-odd:
     * every tool that runs in the person's browser — recording, navigating,
     * creating a task, changing a meeting — was missing from the vocabulary
     * although the run offers all of them. The same seam as the platform
     * reads above, on the other half of the registry.
     *
     * It widens no authority. This list is a VOCABULARY: what a stored tool
     * array may name, and what the page may describe. A client tool still
     * only runs where a surface advertised it, and still runs on the person's
     * own session when it does.
     */
    cachedTools = [
      ...DOMAIN_TOOL_NAMES,
      ...createWriteTools().map((t) => t.name),
      ...toolsFor("all").map((t) => t.name),
      ...CLIENT_TOOL_NAMES,
    ];
  }
  return cachedTools;
}

/** The full definition, prompt included — served only for rows the caller may edit. */
export interface AuthoredSkill {
  id: string;
  level: "org" | "user";
  slug: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  tools: string[];
  starter_questions: string[];
  enabled: boolean;
  max_tool_calls: number | null;
  archived_at: string | null;
  created_at: string;
}

const AUTHORED_COLUMNS = `
  id, level, slug, name, description, prompt, model, tools,
  starter_questions, enabled, max_tool_calls, archived_at, created_at
`;

const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SLUG_RULE = "slug must be 1-63 characters: lowercase letters, digits and dashes, starting with a letter or digit";

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];

const toAuthored = (row: Record<string, unknown>): AuthoredSkill => ({
  id: row.id as string,
  level: row.level as "org" | "user",
  slug: String(row.slug),
  name: String(row.name),
  description: String(row.description ?? ""),
  prompt: String(row.prompt),
  model: (row.model as string | null) ?? null,
  tools: strings(row.tools),
  starter_questions: strings(row.starter_questions),
  enabled: row.enabled === true,
  max_tool_calls: (row.max_tool_calls as number | null) ?? null,
  archived_at: isoOrNull(row.archived_at),
  created_at: iso(row.created_at),
});

interface SkillPatch {
  name?: string | undefined;
  description?: string | undefined;
  prompt?: string | undefined;
  model?: string | null | undefined;
  tools?: string[] | undefined;
  starter_questions?: string[] | undefined;
  enabled?: boolean | undefined;
  max_tool_calls?: number | null | undefined;
}

function assertTools(tools: string[] | undefined): void {
  if (!tools) return;
  const unknown = tools.filter((t) => !availableTools().includes(t));
  if (unknown.length > 0) {
    // fail CLOSED at the door: a typo'd tool would otherwise sit in the
    // list forever, silently never offered — the wired-wrong-fails-silent
    // shape with a config column for a wire
    throw new ValidationError(
      `unknown tool${unknown.length > 1 ? "s" : ""}: ${unknown.sort().join(", ")}`,
      { code: "unknown_tools", params: { tools: unknown.sort().join(",") } },
    );
  }
}

/**
 * A pinned model must be one the product will actually serve.
 *
 * The no-Claude rule's other 2026-08-29 gap. A skill's `model` column pins a
 * model for every run of that skill, and it was free text on both create and
 * patch — so an admin could pin a barred model and every run of that skill
 * would route to it, on a path no `assertAskable` ever sees because nobody
 * types a model at run time.
 *
 * Refused BY NAME here, and only here, which is the ruling from the day the
 * stale-preference case was found: a person typing a model deserves to be
 * told which model was refused and why. The RUN side (`modelForRun`) treats
 * a barred pin as an absent rung instead, so a row written before this wall
 * existed costs the caller's choice rather than the whole run.
 *
 * Deliberately the exclusion only, NOT catalogue membership. `assertAskable`
 * additionally requires the id to be in the live catalogue, which is right
 * for an ask happening now and wrong for a durable pin: a catalogue fetch
 * outage would start refusing edits to skills whose model is perfectly fine,
 * and the skill editor is not where someone should meet OpenRouter's uptime.
 */
function assertPinnable(model: string | null | undefined): void {
  if (typeof model !== "string" || model === "") return;
  if (firstServable(model) === null) {
    throw new ValidationError(`model is not available on this product: ${model}`, {
      code: "model_not_available",
      params: { model },
    });
  }
}

function assertQuestions(questions: string[] | undefined): void {
  if (!questions) return;
  if (questions.length > 8) {
    throw new ValidationError("at most 8 starter questions", { code: "too_many_questions" });
  }
  if (questions.some((q) => !q.trim())) {
    throw new ValidationError("starter questions cannot be blank", { code: "blank_question" });
  }
}

export function createSkillAuthoring(db: Db) {
  return {
    /**
     * The rows the CALLER may edit, full definitions (prompt included).
     * Deliberately not the resolved picker view: an editor needs disabled
     * and shadowed rows — the resolver's collapse is exactly what an author
     * has to see through. Admins get the org's rows; everyone gets their
     * own. Archived rows ride along so "bring back /recap" is possible.
     */
    async manageList(identity: Identity): Promise<AuthoredSkill[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // the WALL already scopes visibility; this filters to editability
          // (a member sees org rows but may not edit them — serving prompts
          // they cannot change would widen the picker's own posture)
          `select ${AUTHORED_COLUMNS} from echo.skill
            where (level = 'org' and $1)
               or (level = 'user' and user_id = $2)
            order by level, name`,
          [identity.role === "admin" || identity.role === "owner", identity.userId],
        ),
      );
      return rows.map(toAuthored);
    },

    async detail(identity: Identity, skillId: string): Promise<AuthoredSkill> {
      const id = assertUuid(skillId, "skill id");
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          `select ${AUTHORED_COLUMNS} from echo.skill
            where id = $1
              and ((level = 'org' and $2) or (level = 'user' and user_id = $3))`,
          [id, identity.role === "admin" || identity.role === "owner", identity.userId],
        ),
      );
      if (!rows[0]) throw new NotFoundError("skill not found");
      return toAuthored(rows[0]);
    },

    async create(
      identity: Identity,
      input: {
        level: "org" | "user";
        slug: string;
        name: string;
        prompt: string;
        description?: string | undefined;
        model?: string | null | undefined;
        tools?: string[] | undefined;
        starter_questions?: string[] | undefined;
        max_tool_calls?: number | null | undefined;
      },
    ): Promise<AuthoredSkill> {
      if (input.level !== "org" && input.level !== "user") {
        // 'system' is not a caller-mintable level and never will be: the
        // floor is a deployment fact (rule 7's loud-floor corollary), and a
        // route that could create one would make the floor supplyable
        throw new ValidationError("level must be org or user");
      }
      if (input.level === "org" && !(identity.role === "admin" || identity.role === "owner")) {
        // the wall would refuse this too (skill_org_write) — pre-stated so
        // the caller gets a sentence instead of a bare 42501
        throw new NotActivatedError("org skills are authored by admins");
      }
      const slug = input.slug.trim().toLowerCase();
      if (!SLUG_FORMAT.test(slug)) {
        throw new ValidationError(SLUG_RULE, { code: "slug_format" });
      }
      if (!input.name.trim()) throw new ValidationError("name cannot be empty");
      if (!input.prompt.trim()) throw new ValidationError("prompt cannot be empty");
      assertTools(input.tools);
      assertPinnable(input.model);
      assertQuestions(input.starter_questions);

      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `insert into echo.skill
               (level, org_id, user_id, slug, name, description, prompt, model,
                tools, starter_questions, max_tool_calls, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8,
                     ${JSONB_PARAM(9)}, ${JSONB_PARAM(10)}, $11, $12)
             returning ${AUTHORED_COLUMNS}`,
            [
              input.level,
              identity.orgId,
              input.level === "user" ? identity.userId : null,
              slug,
              input.name.trim(),
              input.description?.trim() ?? "",
              input.prompt,
              input.model ?? null,
              toJsonb(input.tools ?? []),
              toJsonb(input.starter_questions ?? []),
              input.max_tool_calls ?? null,
              identity.userId,
            ],
          ),
        );
        if (!rows[0]) throw new NotFoundError("skill not created");
        return toAuthored(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(`a ${input.level} skill named /${slug} already exists`, {
            code: "slug_taken",
            params: { slug },
          });
        }
        throw error;
      }
    },

    async update(identity: Identity, skillId: string, patch: SkillPatch): Promise<AuthoredSkill> {
      const id = assertUuid(skillId, "skill id");
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new ValidationError("nothing to update", { code: "nothing_to_update" });
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        throw new ValidationError("name cannot be empty");
      }
      if (patch.prompt !== undefined && !patch.prompt.trim()) {
        throw new ValidationError("prompt cannot be empty");
      }
      assertTools(patch.tools);
      assertPinnable(patch.model);
      assertQuestions(patch.starter_questions);

      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<Record<string, unknown>>(
          // supplied-flag shape, same as the profile patch: coalesce alone
          // could not express clearing the model pin back to "caller's choice"
          `update echo.skill
              set name              = case when $2  then $3::text else name end,
                  description       = case when $4  then $5::text else description end,
                  prompt            = case when $6  then $7::text else prompt end,
                  model             = case when $8  then $9::text else model end,
                  tools             = case when $10 then ${JSONB_PARAM(11)} else tools end,
                  starter_questions = case when $12 then ${JSONB_PARAM(13)} else starter_questions end,
                  enabled           = case when $14 then $15::boolean else enabled end,
                  max_tool_calls    = case when $16 then $17::integer else max_tool_calls end
            where id = $1
            returning ${AUTHORED_COLUMNS}`,
          [
            id,
            patch.name !== undefined, patch.name?.trim() ?? null,
            patch.description !== undefined, patch.description?.trim() ?? null,
            patch.prompt !== undefined, patch.prompt ?? null,
            patch.model !== undefined, patch.model ?? null,
            patch.tools !== undefined, toJsonb(patch.tools ?? []),
            patch.starter_questions !== undefined, toJsonb(patch.starter_questions ?? []),
            patch.enabled !== undefined, patch.enabled ?? null,
            patch.max_tool_calls !== undefined, patch.max_tool_calls ?? null,
          ],
        ),
      );
      // no row: invisible, not editable, or a system row — one 404 for all
      if (!rows[0]) throw new NotFoundError("skill not found");
      return toAuthored(rows[0]);
    },

    /** Archive frees the slug (0018); unarchive can 409 if it was re-taken. */
    async setArchived(identity: Identity, skillId: string, archived: boolean): Promise<AuthoredSkill> {
      const id = assertUuid(skillId, "skill id");
      try {
        const rows = await db.withIdentity(identity, (tx: SqlTx) =>
          tx.unsafe<Record<string, unknown>>(
            `update echo.skill
                set archived_at = case when $2::boolean then now() else null end
              where id = $1
              returning ${AUTHORED_COLUMNS}`,
            [id, archived],
          ),
        );
        if (!rows[0]) throw new NotFoundError("skill not found");
        return toAuthored(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            "the slug was re-used while this skill was archived — rename one of them first",
            { code: "slug_taken_by_successor" },
          );
        }
        throw error;
      }
    },
  };
}

export type SkillAuthoring = ReturnType<typeof createSkillAuthoring>;
