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
    if (skill.level === "system" && SYSTEM_SKILL_KEYS[skill.slug]) {
      try {
        const raw = t.raw(`starters_${skill.slug}`);
        if (Array.isArray(raw) && raw.every((q) => typeof q === "string")) {
          return raw as string[];
        }
      } catch {
        // no catalogue entry for this slug — the wire's own words serve
      }
    }
    return skill.starter_questions;
  };
}
