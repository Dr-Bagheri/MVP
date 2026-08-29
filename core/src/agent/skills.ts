/**
 * Skills are configuration (M4): prompt + model + tool list, stored as data,
 * editable without a deploy. Three levels — system < org < user — and the
 * most specific wins.
 *
 * Resolution is pure so it is testable without a database; the loader that
 * fetches candidate rows is injected.
 */
import { firstServable } from "../api/models.ts";
import type { Identity, Skill } from "./types.ts";

const PRECEDENCE = { system: 0, org: 1, user: 2 } as const;

export interface SkillSource {
  /** All enabled skills visible to this identity, any level. */
  listVisible(identity: Identity): Promise<Skill[]>;
}

/**
 * Collapse candidates to one skill per slug: the most specific level wins.
 * Disabled skills are dropped BEFORE precedence, so an org can't be shadowed
 * into having no skill by a disabled user-level override... but a disabled
 * *override* correctly falls back to the level beneath it.
 */
export function resolveSkills(candidates: Skill[]): Map<string, Skill> {
  const bySlug = new Map<string, Skill>();
  for (const skill of candidates) {
    if (!skill.enabled) continue;
    const current = bySlug.get(skill.slug);
    if (!current || PRECEDENCE[skill.level] > PRECEDENCE[current.level]) {
      bySlug.set(skill.slug, skill);
    }
  }
  return bySlug;
}

export async function resolveSkill(
  source: SkillSource,
  identity: Identity,
  slug: string,
): Promise<Skill | undefined> {
  const visible = await source.listVisible(identity);
  return resolveSkills(visible).get(slug);
}

/**
 * The model a run uses: the skill's pin, else the caller's choice.
 * M5 — no default model is imposed by the product.
 *
 * ── the sixth copy of the ladder (2026-08-29) ──────────────────────────────
 * `skill?.model ?? callerModel` was a two-rung ladder that asked neither rung
 * whether the product would serve it. The no-Claude rule has now failed five
 * times, each time in a copy of the ladder somebody had written out fresh, so
 * the lesson is no longer "fix this one": **a rule enforced on the path a
 * person watches is not enforced**, and a ladder is only as good as its
 * least-guarded copy.
 *
 * A pinned model is not typed at run time — a skill was configured with it
 * once, possibly months ago — so a barred pin is treated exactly as a stale
 * stored preference is: **a rung naming a barred model is a rung that is not
 * there**, and the ladder continues to the caller's choice. It does not
 * throw. Refusing here would turn one bad row into every run of that skill
 * failing, for a person who never chose the model and cannot see the pin.
 *
 * The place to refuse BY NAME is where a human types it — `api/skills.ts`
 * does that on create and patch, so a new pin cannot be barred at all, and
 * this rung only ever catches a row that predates the wall.
 */
export function modelForRun(skill: Skill | undefined, callerModel: string | undefined): string {
  const chosen = firstServable(skill?.model, callerModel);
  if (!chosen) {
    throw new Error("no model selected: the skill pins none and the caller chose none");
  }
  return chosen;
}
