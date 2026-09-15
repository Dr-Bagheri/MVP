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
 * The map is keyed on the SEEDED TEXT, which is the identity these rows have
 * — they carry no slug, and adding one would be a migration to solve a
 * display problem.
 *
 * ── AND THE SEEDED TEXT IS NOT ALWAYS PERSIAN (2026-09-09) ────────────────
 *
 * There are TWO producers. `DEFAULT_COLUMNS` in core/src/api/tasks.ts writes
 * the Persian on an organisation's first visit to the board; the demo console
 * (M52) seeds a board from a language PACK, and the English pack writes
 * "Backlog / To do / In progress / Done" (`demo-seed/content.en.ts`). This map
 * knew only the first, so an English-seeded board was un-localisable: a
 * Persian reader of `acme` — an English organisation with Persian-reading
 * colleagues, which is the ordinary case for this product's customers — got
 * "Backlog" above their cards, on a Persian screen, with nothing
 * malfunctioning.
 *
 * That is the SAME defect this file was written for, pointed the other way,
 * and it is the direction a Persian-first team is structurally less likely to
 * look at. So both shipped spellings map to the one key. The two literals
 * either side are the two producers', copied; `seededNames.test.ts` is where
 * a producer that renames one has to be noticed.
 *
 * A column named "Done" that nobody seeded — an org that typed it — is
 * indistinguishable from the seeded one and will localize. That is the price
 * of having no slug, it is the price the Persian side has always paid, and it
 * costs a word rather than a fact: the column still holds the same cards.
 */
const SEEDED_COLUMNS: Readonly<Record<string, string>> = {
  "بک‌لاگ": "backlog",
  "برای انجام": "todo",
  "در حال انجام": "doing",
  "انجام‌شده": "done",
  "Backlog": "backlog",
  "To do": "todo",
  "In progress": "doing",
  "Done": "done",
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
