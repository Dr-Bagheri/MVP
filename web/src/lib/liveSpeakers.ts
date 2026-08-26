import type { CaptionRow } from "@/lib/captionRows";

/**
 * WHICH live labels count as a voice in the room (user report,
 * 2026-08-26: "it hears 2 people but it is actually just one person").
 *
 * Realtime diarization splits on thin evidence — a throat-clear at the
 * top of a take arrives as its own speaker, and the screen then claims a
 * second person who was never there. The provider is not wrong about the
 * audio; the SCREEN is wrong to call one syllable a participant.
 *
 * So a label becomes a voice once it has said enough to be one: two
 * separate turns, or one turn of real length. Below that the row still
 * renders — the words were said, and dropping them would be worse — but
 * it carries no speaker badge and no entry in the count, because we do
 * not yet claim it is somebody else. The promotion is retroactive by
 * construction: the rows are re-derived on every frame, so the moment a
 * label crosses the bar its earlier rows gain their badge too.
 *
 * Deliberately NOT a merge of the stray into its neighbour: guessing
 * WHICH voice a fragment belongs to is the fabrication this rule exists
 * to avoid. Unclaimed is honest; wrongly attributed is not.
 */
const MIN_TURNS = 2;
const MIN_CHARS = 20;

export function establishedSpeakers(
  order: readonly string[],
  rows: readonly CaptionRow[],
): string[] {
  const turns = new Map<string, number>();
  const chars = new Map<string, number>();
  for (const row of rows) {
    if (row.speaker === undefined) continue;
    turns.set(row.speaker, (turns.get(row.speaker) ?? 0) + 1);
    chars.set(row.speaker, (chars.get(row.speaker) ?? 0) + row.text.trim().length);
  }
  const enough = (label: string) =>
    (turns.get(label) ?? 0) >= MIN_TURNS || (chars.get(label) ?? 0) >= MIN_CHARS;
  /* first-heard order comes from the ENGINE's list, not from re-deriving
     it here: two orderings of one fact drift, and the engine's is the one
     the wire produced */
  const seen = new Set<string>();
  const out = order.filter((label) => enough(label) && !seen.has(label) && seen.add(label));
  // a label the engine never listed (a row that arrived first) still counts
  for (const row of rows) {
    if (row.speaker !== undefined && enough(row.speaker) && !seen.has(row.speaker)) {
      seen.add(row.speaker);
      out.push(row.speaker);
    }
  }
  return out;
}
