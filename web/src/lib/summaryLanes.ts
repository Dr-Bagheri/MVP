import { parseSummary } from "@/components/echo/SummaryBody";

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
 */
export interface SummaryLanes {
  actions: string[];
  decisions: string[];
}

const ACTION_HEADING = /اقدام|کارها|وظیف|action|next step|to-?do/i;
const DECISION_HEADING = /تصمیم|مصوب|decision|resolution/i;

export function summaryLanes(body: string): SummaryLanes {
  const actions: string[] = [];
  const decisions: string[] = [];
  let mode: "a" | "d" | null = null;
  for (const block of parseSummary(body)) {
    if (block.kind === "heading") {
      const heading = block.text ?? "";
      mode = ACTION_HEADING.test(heading)
        ? "a"
        : DECISION_HEADING.test(heading)
          ? "d"
          : null;
    } else if (block.kind === "bullets" && mode !== null) {
      (mode === "a" ? actions : decisions).push(...block.items);
    }
  }
  return { actions, decisions };
}
