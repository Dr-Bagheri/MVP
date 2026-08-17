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
