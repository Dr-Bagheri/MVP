/**
 * The live transcript's ROW rule (2026-08-26, the WhisperUI-style recorder):
 * the caption lane delivers final text in fragments with no timestamps of
 * their own, so rows are built as the fragments arrive — a fragment joins
 * the open row until that row reads finished (sentence-ending punctuation)
 * or grows past a spoken breath (~160 chars); the next fragment then opens
 * a new row stamped with the take's clock at that moment.
 *
 * Pure and immutable so the rule is testable without a microphone.
 */
export interface CaptionRow {
  /** the take's recorded clock when this row OPENED */
  atMs: number;
  text: string;
}

const ROW_DONE = /[.!?؟…]\s*$/;
const ROW_MAX = 160;

export function appendCaptionRow(
  rows: readonly CaptionRow[],
  text: string,
  atMs: number,
): CaptionRow[] {
  const last = rows[rows.length - 1];
  if (last && !ROW_DONE.test(last.text) && last.text.length <= ROW_MAX) {
    return [...rows.slice(0, -1), { atMs: last.atMs, text: last.text + text }];
  }
  return [...rows, { atMs, text }];
}
