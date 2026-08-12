/**
 * Skills are configuration (M4): prompt + model + tool list, stored as data,
 * editable without a deploy. Three levels — system < org < user — and the
 * most specific wins.
 *
 * Resolution is pure so it is testable without a database; the loader that
 * fetches candidate rows is injected.
 */
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
 */
export function modelForRun(skill: Skill | undefined, callerModel: string | undefined): string {
  const chosen = skill?.model ?? callerModel;
  if (!chosen) {
    throw new Error("no model selected: the skill pins none and the caller chose none");
  }
  return chosen;
}
