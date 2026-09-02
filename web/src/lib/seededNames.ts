"use client";

import { useTranslations } from "next-intl";

/**
 * SEEDED NAMES LOCALIZE UNTIL SOMEBODY RENAMES THEM.
 *
 * User directive, 2026-09-02: "change the titles and names in tables and
 * tasks to a translated version when changed from fa to en as well."
 *
 * The task board writes its four columns into the database on an
 * organisation's first visit, in Persian, because that is the language the
 * seed was written in (`DEFAULT_COLUMNS` in core/src/api/tasks.ts). They are
 * rows from then on — so an English reader saw «بک‌لاگ» above their cards, and
 * nothing was malfunctioning: the product had simply written Persian into a
 * table and read it back.
 *
 * This is the workflow-template rule applied to a second kind of seeded copy,
 * and the discipline is what makes it safe: a name is replaced ONLY while it
 * is still word for word what we shipped. An organisation that renamed a
 * column keeps its own word in every language, because that word is a
 * person's and ours is not.
 *
 * The map is keyed on the SEEDED PERSIAN, which is the identity these rows
 * have — they carry no slug, and adding one would be a migration to solve a
 * display problem.
 */
const SEEDED_COLUMNS: Readonly<Record<string, string>> = {
  "بک‌لاگ": "backlog",
  "برای انجام": "todo",
  "در حال انجام": "doing",
  "انجام‌شده": "done",
};

export function useSeededName(): (name: string) => string {
  const t = useTranslations("tasks");
  return (name) => {
    const key = SEEDED_COLUMNS[name.trim()];
    if (key === undefined) return name;
    /* a missing catalogue entry falls back to the stored words — visible and
       untranslated beats invisible, the same fallback every other catalogue
       on this platform takes */
    try {
      const translated = t(`column_${key}` as "column_backlog");
      return translated.startsWith("tasks.") ? name : translated;
    } catch {
      return name;
    }
  };
}
