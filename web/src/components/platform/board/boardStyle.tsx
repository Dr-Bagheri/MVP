"use client";

import { useEffect, useState } from "react";
import { IconPlus } from "@/components/icons";
import { TONE_DOT } from "../tasks/TaskDialogs";

/**
 * ONE BOARD (R17, user ruling 2026-09-05: "there are basically two same kanban
 * tables in tasks and projects that are supposed to be the same but they are
 * different").
 *
 * They were different because they were two COPIES. The projects board was
 * written from the task board's numbers on 2026-09-05 — the same 300px column,
 * the same corner, ground, shadow and 70vh floor — and by the same evening the
 * copies had drifted: a 12px column title against the board's 13, a count
 * badge in a different corner, cards in a different box, no tone on the
 * column. Nobody changed either on purpose; a copy drifts by existing.
 *
 * So the shape lives here once, as the class strings the two boards read.
 * Every value is TaskBoard's own as of 2026-09-05 (the board is the template
 * the user named), moved rather than redesigned:
 *
 *   lane      horizontal scroller, 12px between columns
 *   column    300 wide · 2xl corner · surface ground · card shadow · 10px
 *             inset · 70vh floor, stretching to the lane's height
 *   header    4px inset, the tone well and the title at the start, the count
 *             and the acts at the end — 28px wells, 4px apart
 *   title     13/600, truncating
 *   count     11px subtle on the raised ground, a 6px corner
 *   cards     8px apart, scrolling inside the column
 *   card      the theme's `.card-row` (R7): 16 corner · surface · 12px inset ·
 *             card shadow · a stronger edge under the pointer
 *   add row   the compact control, dashed, filling the column's width
 *
 * A guard (board.guard.test.ts) keeps the two boards reading this module and
 * forbids the literals from returning to either file.
 */

export const BOARD_LANE = "scroll-quiet flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2";

export const BOARD_COLUMN =
  "glass flex w-[300px] shrink-0 flex-col self-stretch rounded-2xl p-2.5 min-h-[70vh]";

export const BOARD_HEADER = "flex items-center justify-between gap-1 px-1 py-1";
export const BOARD_HEADER_START = "flex min-w-0 items-center gap-1";
export const BOARD_HEADER_END = "flex shrink-0 items-center gap-1";
export const BOARD_TITLE = "truncate text-sm font-semibold text-fg";
export const BOARD_COUNT = "badge-num rounded-md bg-surface-2 px-1.5 text-[11px] text-fg-subtle";

export const BOARD_CARDS = "scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto pt-1";
/** the board's card is the theme's list card (R7) — pressable, so the cursor says so */
export const BOARD_CARD = "card-row cursor-pointer";

/**
 * THE CARRIED CARD'S OWN BOX, emptied (2026-09-09).
 *
 * A card being carried is drawn by a clone on the body, so the element left in
 * the column shows nothing and holds the space it came from open. It keeps its
 * box: `.card-row` is border-box, so the dashed 2px edge costs no height and
 * the gap is exactly the card's. The sheet's fill, blur and drop have to be
 * taken back off by hand — an emptied card that still looks like a card reads
 * as a second copy of the one in the air.
 *
 * Both boards wear it, which is why it is here and not spelled in either.
 */
export const BOARD_CARD_SLOT =
  "[&>*]:invisible border-2 border-dashed border-accent/45 bg-accent-soft/40 shadow-none [backdrop-filter:none] cursor-grabbing";

/** the add-COLUMN placeholder at the end of the lane: a narrower dashed column
    with the same floor, so it stands in the row as a column and not a strip */
export const BOARD_ADD_COLUMN =
  "tap flex w-[220px] shrink-0 items-start justify-center gap-2 self-stretch rounded-2xl border border-dashed border-border pt-4 text-sm text-fg-muted hover:border-border-strong hover:text-fg min-h-[70vh]";

/** the dashed row at the foot of a column that makes a new thing where it will live */
export function BoardAddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-sm w-full justify-center gap-1.5 border border-dashed border-border font-medium text-fg-muted hover:border-border-strong hover:text-fg"
    >
      <IconPlus width={12} height={12} />
      {label}
    </button>
  );
}

/**
 * THE SLOT A CARRIED CARD LEAVES AND MAKES (2026-09-09, "should make space for
 * it in the other columns").
 *
 * One component draws both halves of the gesture, because they are the same
 * fact: while a card is carried, the space it occupies belongs to it, and the
 * space is wherever the pointer is. In the column the card CAME FROM it holds
 * the card's own place open so the column below does not jump up; in the
 * column the pointer is OVER it opens a new place at the top, which is where a
 * dropped card actually lands (`moveTask` writes a position ahead of every
 * other card in the column). The height is the carried card's measured one,
 * so the gap is the size of the thing going into it.
 *
 * IT OPENS RATHER THAN APPEARS. A gap that is simply there on the first frame
 * shoves the column's cards down in one jump, which reads as the list
 * breaking; the same gap grown from nothing over 150ms reads as the column
 * making room. That costs a state: the first paint is a closed slot and the
 * next frame is the open one, because a transition needs a value to leave.
 */
export function BoardSlot({ height }: { height: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      aria-hidden
      data-slot=""
      style={{ height: open ? height : 0, opacity: open ? 1 : 0 }}
      className="shrink-0 rounded-xl border-2 border-dashed border-accent/45 bg-accent-soft/40 transition-[height,opacity] duration-150 ease-out motion-reduce:transition-none"
    />
  );
}

/**
 * The column's tone as a read-only well — the same 28px square the task board
 * presses to CHANGE the tone, drawn here without the press: a column's colour
 * is set on the board that owns the columns, and a second place to set it is
 * a second place for it to be wrong.
 */
export function BoardTone({ tone }: { tone: string }) {
  return (
    <span aria-hidden className="btn btn-icon pointer-events-none">
      <span className={`block h-2.5 w-2.5 rounded-full ${TONE_DOT[tone] ?? TONE_DOT.grey!}`} />
    </span>
  );
}
