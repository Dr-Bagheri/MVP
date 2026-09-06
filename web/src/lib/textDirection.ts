/**
 * A LINE'S DIRECTION FROM ITS LANGUAGE (2026-09-06; user directive:
 * "automatic language detection for mixed Persian and English recordings").
 *
 * The transcriber names each line's language (db/0200, the majority of its
 * words); this is the one place that turns the code into what the screen
 * does with it. Right-to-left for the scripts written that way, left-to-right
 * for everything else, and — the half that matters — NOTHING for a line
 * whose language was not identified: `undefined` leaves `dir` unset, so the
 * line follows the document like every line did before today, rather than
 * being pinned to a guess.
 */
const RTL = new Set(["fa", "ar", "ur", "he", "ps", "ckb", "sd", "ug", "yi", "dv"]);

export function dirFor(language: string | null | undefined): "rtl" | "ltr" | undefined {
  if (!language) return undefined;
  const base = language.toLowerCase().split(/[-_]/)[0] ?? "";
  if (base === "") return undefined;
  return RTL.has(base) ? "rtl" : "ltr";
}

export interface LanguageShare {
  code: string;
  /** 0..1 of the lines that named a language */
  share: number;
  lines: number;
}

/**
 * How much of a transcript is in each language, by LINES that named one —
 * for the chip row above a mixed transcript. Rows with no language are not
 * counted and not a share: "not identified" is not a language a reader can
 * be told a percentage of. Sorted by share, then by code, so the order is
 * stable between renders.
 */
export function languageMix(rows: readonly { language: string | null }[]): LanguageShare[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = (row.language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
    if (code === "") continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([code, lines]) => ({ code, lines, share: lines / total }))
    .sort((a, b) => b.share - a.share || a.code.localeCompare(b.code));
}
