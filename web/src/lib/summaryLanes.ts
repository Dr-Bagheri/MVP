import { headingTextOf, isBulletLine, parseSummary } from "@/components/echo/SummaryBody";

/**
 * The ACTIONS / DECISIONS lanes a summary declares about itself.
 *
 * ONE rule, two readers (the record page's own section and the dashboard's
 * cross-record lanes) — extracted the moment the second reader appeared,
 * because two spellings of "which heading means action items" is exactly
 * how the two surfaces start disagreeing about the same document.
 *
 * It reads STRUCTURE, never meaning: a heading naming actions or decisions
 * claims the bullets under it. A summary that declares neither yields
 * nothing, and the caller says so — inventing lanes from prose would be a
 * fabrication wearing a checklist's clothes.
 *
 * Since 2026-08-28 the rule has a WRITER too (`appendLaneItem`): a manual
 * item is written into the summary's own structure, at the place this
 * file's reader will claim it from — never into a parallel store.
 */
export interface SummaryLanes {
  actions: string[];
  decisions: string[];
}

export type Lane = "actions" | "decisions";

const ACTION_HEADING = /اقدام|کارها|وظیف|action|next step|to-?do/i;
const DECISION_HEADING = /تصمیم|مصوب|decision|resolution/i;

/** Which lane a heading claims. Action first, mirroring nothing — this IS
    the tie-break, and both the reader and the writer call it, so a heading
    matching both regexes goes to the same lane on both sides. */
function laneOf(heading: string): Lane | null {
  return ACTION_HEADING.test(heading)
    ? "actions"
    : DECISION_HEADING.test(heading)
      ? "decisions"
      : null;
}

export function summaryLanes(body: string): SummaryLanes {
  const lanes: SummaryLanes = { actions: [], decisions: [] };
  let mode: Lane | null = null;
  for (const block of parseSummary(body)) {
    if (block.kind === "heading") {
      mode = laneOf(block.text ?? "");
    } else if (block.kind === "bullets" && mode !== null) {
      lanes[mode].push(...block.items);
    }
  }
  return lanes;
}

/**
 * Fallback headings for a document that declares no lane yet — Persian, like
 * the record itself (Persian-first: the summary is a Persian document even
 * under the English UI). Each matches its OWN lane's regex and not the
 * other's, which `summaryLanes.test.ts` asserts by reading the result back.
 */
const LANE_HEADING: Record<Lane, string> = {
  actions: "## اقدامات",
  decisions: "## تصمیم‌ها",
};

/**
 * Append one manual item into a lane of the summary DOCUMENT — the text that
 * travels through the 0092 human-edit door. The insertion is a single new
 * line; every other byte of the document survives verbatim, so the version
 * diff shows exactly the addition and nothing else.
 *
 * Placement mirrors the reader above line for line: a heading claims
 * everything until the next heading, so the item lands after the LAST bullet
 * the lane's LAST heading claims (or right under that heading when it has no
 * bullets yet). No matching heading at all → a new lane heading is appended
 * at the document's end, so the reader — and the dashboard's cross-record
 * lanes — can claim the item back.
 */
export function appendLaneItem(body: string, lane: Lane, item: string): string {
  // a multi-line "bullet" would escape the bullet and re-enter the document
  // as prose the reader never claims — collapse it before it can
  const bullet = `- ${item.trim().replace(/\s*\n\s*/g, " ")}`;
  const lines = body.split("\n");
  let current: Lane | null = null;
  let insertAfter = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const heading = headingTextOf(line);
    if (heading !== null) {
      current = laneOf(heading);
      if (current === lane) insertAfter = i;
      continue;
    }
    if (current === lane && isBulletLine(line)) insertAfter = i;
  }
  if (insertAfter === -1) {
    const tail = `${LANE_HEADING[lane]}\n${bullet}`;
    return body.trim() === "" ? tail : `${body.replace(/\n+$/, "")}\n\n${tail}`;
  }
  return [
    ...lines.slice(0, insertAfter + 1),
    bullet,
    ...lines.slice(insertAfter + 1),
  ].join("\n");
}
