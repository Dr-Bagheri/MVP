/**
 * The database behind `SkillSource` (M4: agents are configuration).
 *
 * `skills.ts` holds the resolution rule — system < org < user, most specific
 * wins — as a pure function, and this file is the only thing that knows where
 * the rows come from. That split is why the precedence logic is testable
 * without a database and why this file has almost no logic to get wrong.
 *
 * Visibility is NOT re-implemented here. db/0013's `skill_read` already says
 * it: system skills to everyone, org skills to the org, user skills to their
 * owner. This selects enabled rows and lets RLS decide which ones exist —
 * the same posture as calls.ts, for the same reason. A predicate written
 * twice is a predicate that can disagree once.
 */
import { assertUuid, type Db, type SqlTx } from "../db/identity.ts";
import { resolveSkill as resolveFrom, type SkillSource } from "./skills.ts";
import type { Identity, Skill } from "./types.ts";

/**
 * Read from the catalogue, not from the migration file or the type.
 *
 * I first wrote `max_tool_calls` into this list because `Skill.maxToolCalls`
 * exists in types.ts (the steward's per-skill ceiling ruling). **There is no
 * such column** — `information_schema` on the live database says `echo.skill`
 * is id, level, org_id, user_id, slug, name, description, prompt, model,
 * tools, enabled, created_by, created_at, updated_at, archived_at. The select
 * would have thrown `42703 column does not exist` on the first real skill
 * lookup, and no fake would have objected. See `maxToolCalls` below for what
 * that means in practice.
 *
 * The same check found `archived_at`, which is not in 0007 and which I would
 * otherwise have ignored — an archived skill would have kept resolving.
 */
const SKILL_COLUMNS = `
  id, level, slug, name, description, prompt, model, tools, enabled,
  max_tool_calls
`;

interface SkillRow {
  id: string;
  level: "system" | "org" | "user";
  slug: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  tools: unknown;
  enabled: boolean;
  max_tool_calls: number | null;
}

/**
 * `tools` is jsonb with a `jsonb_typeof = 'array'` constraint, so it arrives
 * as an array — but a non-string element would reach the tool wall as
 * `undefined` and quietly widen or narrow what a skill may call. Filtering to
 * strings here means a malformed row costs one tool, not the whole skill, and
 * never produces a tool name that isn't one.
 */
const toTools = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];

const toSkill = (row: SkillRow): Skill => ({
  id: row.id,
  level: row.level,
  slug: row.slug,
  name: row.name,
  description: row.description,
  prompt: row.prompt,
  // NULL stays null: it means "use the caller's model" (M5, no imposed
  // default). Coercing it to a string here would invent a product policy.
  model: row.model,
  tools: toTools(row.tools),
  enabled: row.enabled,
  /**
   * Per-skill tool-call ceiling (M4 amendment, db/0025).
   *
   * NULL means **inherit `DEFAULT_MAX_TOOL_CALLS` (24)**, not "unlimited" —
   * a skill that says nothing should inherit a ceiling rather than escape
   * one. runtime.ts already reads it as
   * `request.maxToolCalls ?? skill?.maxToolCalls ?? DEFAULT`, so null falls
   * through to the default by construction rather than by a check here.
   *
   * The column arrived after the field did: it briefly outran the document,
   * and Backend 3 refused to add a column for a decision nobody had made
   * until the steward ruled. Worth remembering as the good version of this
   * failure mode — a type without a column is far cheaper than a column
   * without a decision.
   */
  maxToolCalls: row.max_tool_calls,
});

export function createSkillStore(db: Db): SkillSource {
  return {
    async listVisible(identity: Identity): Promise<Skill[]> {
      const rows = await db.withIdentity(identity, (tx: SqlTx) =>
        tx.unsafe<SkillRow>(
          // `archived_at is null` as well as `enabled`: they are different
          // acts. Disabling is "off for now" and an org-level disable
          // correctly falls back to the system skill beneath it; archiving is
          // "gone", and an archived skill should not resolve at all.
          `select ${SKILL_COLUMNS} from echo.skill
            where enabled and archived_at is null
            order by level`,
        ),
      );
      return rows.map(toSkill);
    },
  };
}

/**
 * The `resolveSkill` the api and the worker both hand to the runtime.
 *
 * One function so the assistant's `/skill` invocation and the pipeline's
 * summarizer resolve identically. If the summarizer used its own lookup, an
 * org that customised the summarizer prompt would find it applied in one
 * place and not the other — and that divergence would look like the model
 * behaving inconsistently rather than like a bug.
 */
export function createResolveSkill(db: Db) {
  const source = createSkillStore(db);
  return (identity: Identity, slug: string): Promise<Skill | undefined> =>
    resolveFrom(source, identity, slug);
}

/** The slug migration 0015 ships the summarizer under. */
export const SUMMARIZER_SLUG = "summarizer";

/**
 * Slugs the PRODUCT ships as system skills. A miss on one of these is a
 * fault, not an answer — see `MissingSystemSkillError`.
 */
export const SYSTEM_SLUGS: readonly string[] = [SUMMARIZER_SLUG];

/**
 * A system skill did not resolve.
 *
 * This is deliberately fatal, and the reasoning is worth keeping (steward
 * ruling, CLAUDE.md rule 7 corollary "a missing floor is loud"):
 *
 * `resolveSkill` returning `undefined` used to be absorbed as "no skill
 * configured, use the runtime's own prompt". For an ORG or USER override
 * that is correct — falling through to the rung beneath is the resolution
 * ladder working. For a SYSTEM skill there is no rung beneath, so a miss can
 * only mean the seed is broken or the caller's identity is invalid.
 *
 * The consequence when it was silent: summaries were generated WITHOUT the
 * shipped anti-fabrication prompt and nothing said so. They looked fine —
 * that is the problem. A summarizer quietly running on a different prompt
 * than the one reviewed is exactly the failure the audit trail exists to
 * make impossible, and it was invisible because something helpful absorbed
 * it.
 *
 * I reported this as a missing seed. It was not: Backend 3 proved the row
 * has been there since 0015, and my read used an actor that was not an
 * `app_user` row. db/0018 moved `skill_read`'s system clause behind
 * `actor_is_active()`, so an invalid identity sees no skills at all — which
 * is the second thing this error can mean, and the one I actually hit.
 */
export class MissingSystemSkillError extends Error {
  constructor(slug: string) {
    super(
      `system skill "${slug}" did not resolve: either the migration seed is `
      + `missing or the caller's identity is not an active member `
      + `(db/0018 gates system skills behind actor_is_active)`,
    );
  }
}

/**
 * The summarizer's resolver, shaped for the worker: identity in, skill out.
 *
 * The pipeline has no slug to pass — it always wants the summarizer — so the
 * specialisation belongs here, next to the slug it specialises on, rather
 * than as an inline lambda in the worker's wiring where the string would be
 * invisible.
 *
 * **Throws rather than returning undefined.** The return type stays
 * `Promise<Skill | undefined>` to match the worker's expected shape, but the
 * undefined branch is now unreachable: see MissingSystemSkillError.
 */
export function createSummarizerResolver(db: Db) {
  const resolve = createResolveSkill(db);
  return async (identity: Identity): Promise<Skill | undefined> => {
    const skill = await resolve(identity, SUMMARIZER_SLUG);
    if (!skill) throw new MissingSystemSkillError(SUMMARIZER_SLUG);
    return skill;
  };
}

/**
 * The api's resolver for a caller-supplied `/slug`.
 *
 * A miss on a user-typed slug is a 400, not a fault — the caller asked for
 * something that isn't there. But a miss on a slug the PRODUCT ships is the
 * fault above, and the two must not be conflated: answering "unknown skill"
 * for a broken seed would hand the user a validation error for our problem.
 */
export function createNamedSkillResolver(db: Db) {
  const resolve = createResolveSkill(db);
  return async (identity: Identity, slug: string): Promise<Skill | undefined> => {
    const skill = await resolve(identity, slug);
    if (!skill && SYSTEM_SLUGS.includes(slug)) throw new MissingSystemSkillError(slug);
    return skill;
  };
}

/**
 * Skills the caller may invoke, for a picker. Ordered by name; the resolution
 * has already collapsed each slug to its winning level, so an org override
 * appears once, under the org's wording, not twice.
 */
export async function listResolvedSkills(db: Db, identity: Identity): Promise<Skill[]> {
  const source = createSkillStore(db);
  const visible = await source.listVisible(identity);
  const { resolveSkills } = await import("./skills.ts");
  return [...resolveSkills(visible).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

/** Read one skill by id — the replay surface's companion to agent_run.skill_id. */
export async function getSkill(
  db: Db, identity: Identity, skillId: string,
): Promise<Skill | undefined> {
  const id = assertUuid(skillId, "skill id");
  const rows = await db.withIdentity(identity, (tx: SqlTx) =>
    tx.unsafe<SkillRow>(
      // No archived_at filter here on purpose: this is the replay surface for
      // `agent_run.skill_id`, and a run that used a skill since archived must
      // still be explainable. Invariant 5 is about what happened, not about
      // what is currently offered.
      `select ${SKILL_COLUMNS} from echo.skill where id = $1 limit 1`,
      [id],
    ),
  );
  const row = rows[0];
  return row ? toSkill(row) : undefined;
}
