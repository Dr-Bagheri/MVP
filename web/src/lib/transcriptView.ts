/**
 * Pure view-math for the record page (2026-08-24, the 20-item build):
 * paragraph merging, talk-time shares, version diffing, title suggestion.
 * Pure functions so each is testable without a DOM.
 */

export interface ViewRow {
  id: string;
  speaker_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface ParagraphBlock {
  speaker_id: string | null;
  start_ms: number;
  end_ms: number;
  ids: string[];
  texts: string[];
}

/** #8 paragraph mode: consecutive same-speaker lines flow together. */
export function mergeParagraphs(rows: ViewRow[]): ParagraphBlock[] {
  const out: ParagraphBlock[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && last.speaker_id === row.speaker_id) {
      last.texts.push(row.text);
      last.ids.push(row.id);
      last.end_ms = row.end_ms;
    } else {
      out.push({
        speaker_id: row.speaker_id,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        ids: [row.id],
        texts: [row.text],
      });
    }
  }
  return out;
}

/** #10 talk time per speaker, sorted by share (0..1). */
export function talkTimes(rows: ViewRow[]): { speaker_id: string | null; ms: number; share: number }[] {
  const sums = new Map<string | null, number>();
  for (const row of rows) {
    const span = Math.max(0, row.end_ms - row.start_ms);
    sums.set(row.speaker_id, (sums.get(row.speaker_id) ?? 0) + span);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([speaker_id, ms]) => ({ speaker_id, ms, share: total > 0 ? ms / total : 0 }))
    .sort((a, b) => b.ms - a.ms);
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** #6 version diff: plain line-level LCS — enough to show what changed. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  // LCS table (files are small — summaries, not novels)
  const dp: number[][] = Array.from({ length: A.length + 1 }, () =>
    new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i -= 1) {
    for (let j = B.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = A[i] === B[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      out.push({ kind: "same", text: A[i]! });
      i += 1; j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "removed", text: A[i]! });
      i += 1;
    } else {
      out.push({ kind: "added", text: B[j]! });
      j += 1;
    }
  }
  while (i < A.length) { out.push({ kind: "removed", text: A[i]! }); i += 1; }
  while (j < B.length) { out.push({ kind: "added", text: B[j]! }); j += 1; }
  return out;
}

/** #14: only titles the RECORDER invented deserve a suggestion — a name a
    person typed is never second-guessed. */
export function isGenericTitle(title: string): boolean {
  return /^(?:meeting|call|جلسه|یادداشت صوتی)[\s‌]*[\d۰-۹:٫.]*$/i.test(title.trim());
}

/** First heading's text, else the first sentence — bounded so a suggestion
    is a TITLE, not a paragraph. Null when nothing usable exists. */
export function suggestTitleFrom(summary: string): string | null {
  const lines = summary.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s*(.+)$/)?.[1]
      ?? line.match(/^\*\*(.+?)\*\*:?$/)?.[1];
    if (heading) {
      const clean = heading.replace(/[*:]+$/g, "").trim();
      // a heading that is just the word «خلاصه»/"Summary" names the genre,
      // not the meeting
      if (clean.length >= 4 && !/^(خلاصه|summary)$/i.test(clean)) {
        return clean.slice(0, 60);
      }
      continue;
    }
    const sentence = line.split(/[.!؟?۔]/)[0]?.trim() ?? "";
    if (sentence.length >= 8) return sentence.slice(0, 60);
  }
  return null;
}
