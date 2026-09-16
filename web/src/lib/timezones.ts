/**
 * The zones the time-zone picker offers — a short list, not the IANA set: a
 * 400-entry dropdown is unusable, and «Auto» already covers everyone whose
 * device clock is right.
 *
 * ONE list, here. It had been written out twice (GeneralSettings and the
 * avatar menu), and the second copy was dead code that nothing imported and
 * that still carried its own labels — the two-spellings shape, one of them
 * unexercised.
 *
 * A zone is SHOWN by its catalogue label and never by its identifier (user,
 * 2026-09-16: "this dropdown still is in english, translate it"). The id is
 * what is STORED and what `Intl` is asked for; the label is what a person
 * reads, in the screen's language. `timezoneLabelKey` derives the catalogue
 * key from the id so the list and its words cannot be added separately —
 * `timezones.test.ts` asks BOTH catalogues for every member, and a zone added
 * here without its words goes red there rather than rendering as a raw id.
 */
export const TIMEZONES = [
  "Asia/Tehran",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
] as const;

export type Timezone = (typeof TIMEZONES)[number];

/** the `platform.*` catalogue key that names a zone: `Asia/Tehran` → `tz_Asia_Tehran` */
export function timezoneLabelKey(zone: string): string {
  return `tz_${zone.replace(/[^A-Za-z0-9]+/g, "_")}`;
}
