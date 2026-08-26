import type { CaptionRow } from "@/lib/captionRows";

/**
 * WHICH slice of audio is safe to ask "whose voice is this?" about.
 *
 * The hazard this exists for: a caption row's stamp is when its text
 * ARRIVED, not when it was spoken. Recognition runs a second or three
 * behind the room, so cutting audio at a row's own timestamp lands late —
 * often inside the NEXT person's turn — and a snippet that straddles a
 * handover matches whoever happens to dominate it. A wrong name is worse
 * than no name, so the window is only ever taken from the middle of a run
 * one voice has plainly owned for a while:
 *
 *   ├──────────── one label, no other, for RUN_MS ────────────┤
 *                 ├─ WINDOW_MS ─┤
 *                               └─ LAG_MS ─┤ now
 *
 * With the defaults, a 4s window ending 3s ago, taken only when the same
 * voice has held the last 11s, sits inside that turn with seconds of
 * margin at both ends — enough that the lag cannot walk it into a
 * neighbour. If anyone else spoke in that stretch, there is no plan: the
 * honest answer to "who was that?" is sometimes silence.
 */
export const LAG_MS = 3_000;
export const WINDOW_MS = 4_000;
export const RUN_MS = 11_000;

export interface SnippetPlan {
  label: string;
  startMs: number;
  endMs: number;
}

export function planSnippet(
  rows: readonly CaptionRow[],
  nowMs: number,
  opts: { lagMs?: number; windowMs?: number; runMs?: number } = {},
): SnippetPlan | null {
  const lag = opts.lagMs ?? LAG_MS;
  const window = opts.windowMs ?? WINDOW_MS;
  const run = opts.runMs ?? RUN_MS;
  const voiced = rows.filter((row) => row.speaker !== undefined);
  const last = voiced[voiced.length - 1];
  if (!last) return null;
  const label = last.speaker!;
  const endMs = nowMs - lag;
  const startMs = endMs - window;
  // nobody else in the whole stretch — one interjection and the window is
  // no longer provably one person's, whatever the arithmetic says
  if (voiced.some((row) => row.atMs >= nowMs - run && row.speaker !== label)) return null;
  /* the run must ALREADY have been under way when the window opens, and
     must still have been under way at its end. Measured from the rows
     themselves rather than from the lookback: a slow talker's rows are
     sparse, and refusing them because they left a gap would mean the one
     person a recorder can most easily name never gets named. */
  if (!voiced.some((row) => row.atMs <= startMs)) return null;
  if (last.atMs < startMs) return null;
  return { label, startMs, endMs };
}
