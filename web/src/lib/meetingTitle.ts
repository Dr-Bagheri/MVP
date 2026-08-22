/**
 * The auto-name for an untitled recording (user rule, 2026-08-22: "the
 * title must not be empty — if the user didn't write one, go with
 * meeting 1, 2, 3 and so on").
 *
 * The next number is max(existing "Meeting N" / «جلسه N») + 1 — counting
 * rows would collide after a rename or delete; the max never does. Both
 * languages' names are counted as ONE series, so switching UI language
 * never restarts the numbering.
 */
const MEETING_RE = /^(?:Meeting|جلسه)\s+(\d+)$/u;

export function nextMeetingTitle(
  rows: readonly { title: string | null }[],
  locale: string,
): string {
  let highest = 0;
  for (const row of rows) {
    const match = row.title ? MEETING_RE.exec(row.title.trim()) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const next = highest + 1;
  return locale === "fa" ? `جلسه ${next}` : `Meeting ${next}`;
}
