"use client";

import { useTranslations } from "next-intl";

/**
 * Display names for skills (user report: «خلاصه‌ساز» rendered in the
 * English UI).
 *
 * The line that decides this: SYSTEM skills are SHIPPED PRODUCT CONTENT,
 * so their names are product strings and localize like any other product
 * string. Org- and user-authored skills are the other side of that line —
 * their names render AS AUTHORED, always, the same verdict as person
 * names ("names never change").
 *
 * The map is a closed list on purpose: a future system skill whose slug is
 * not here falls back to its stored name rather than crashing on a missing
 * key — visible and wrong beats invisible and broken, and the catalogue
 * gains the key the day the skill ships.
 */
const SYSTEM_SKILL_KEYS: Readonly<Record<string, string>> = {
  summarizer: "system_summarizer",
  tasks: "system_tasks",
  decisions: "system_decisions",
  minutes: "system_minutes",
  translator: "system_translator",
};

export function useSkillName(): (skill: { level: string; slug: string; name: string }) => string {
  const t = useTranslations("skills");
  return (skill) => {
    const key = skill.level === "system" ? SYSTEM_SKILL_KEYS[skill.slug] : undefined;
    return key ? t(key) : skill.name;
  };
}

/**
 * Starter questions, by the same line that decides names (user report,
 * 2026-08-18: the English hub suggested «کارهای این تماس را فهرست کن»):
 * SYSTEM skills are shipped product content, so their starters localize;
 * authored skills' starters render as authored, always.
 *
 * The catalogue keys mirror the shipped DB values — the same both-catalogues
 * arrangement the system skill NAMES already live under, and it carries the
 * same duty: a migration that edits a system skill's starters edits the
 * catalogues in the same change. A skill without a catalogue entry falls
 * back to the wire — visible and untranslated beats invisible and broken.
 */
export function useSkillStarters(): (skill: {
  level: string;
  slug: string;
  starter_questions: string[];
}) => string[] {
  const t = useTranslations("skills");
  return (skill) => {
    /*
     * ASK THE CATALOGUE WE ARE ABOUT TO READ (review F15).
     *
     * This used to guard on `SYSTEM_SKILL_KEYS[skill.slug]` — a different list
     * that happens to sit nearby. It declares five slugs; the starters
     * catalogue carries three, because `summarizer` and `translator`
     * deliberately ship none. So the guard answered a question about one list
     * and the next line acted on the other, and every render of the assistant
     * menu emitted `MISSING_MESSAGE: Could not resolve
     * skills.starters_summarizer` — in both locales.
     *
     * The `try`/`catch` that wrapped this could never fire: use-intl's `raw`
     * reports the miss through `onError` (`console.error` by default) and
     * RETURNS the key path; it does not throw. The fallback still happened one
     * line down, because `Array.isArray("skills.starters_translator")` is
     * false. The right answer, reached by accident, with two errors on the
     * console that no assertion could see — every test here read the return
     * value, and the return value was correct in both versions.
     *
     * `t.has` resolves the same path and reports nothing. Asking is silent;
     * reading is not. `SYSTEM_SKILL_KEYS` keeps its real job in
     * `useSkillName` above.
     */
    if (skill.level === "system" && t.has(`starters_${skill.slug}`)) {
      const raw = t.raw(`starters_${skill.slug}`);
      if (Array.isArray(raw) && raw.every((q) => typeof q === "string")) {
        return raw as string[];
      }
    }
    return skill.starter_questions;
  };
}
