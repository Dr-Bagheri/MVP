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
  /**
   * The provider's speaker label, when the lane diarizes (2026-08-26).
   * Absent means the lane attached none — NOT "one speaker": the
   * difference decides whether a UI may say a number out loud.
   */
  speaker?: string;
}

const ROW_DONE = /[.!?؟…]\s*$/;
const ROW_MAX = 160;

export function appendCaptionRow(
  rows: readonly CaptionRow[],
  text: string,
  atMs: number,
  speaker?: string,
): CaptionRow[] {
  const last = rows[rows.length - 1];
  /* a SPEAKER CHANGE always opens a row, before any punctuation or length
     rule gets a say — two people's words inside one stamped row is the one
     mistake a transcript must never make */
  if (
    last
    && last.speaker === speaker
    && !ROW_DONE.test(last.text)
    && last.text.length <= ROW_MAX
  ) {
    return [...rows.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...rows, { atMs, text, ...(speaker === undefined ? {} : { speaker }) }];
}
