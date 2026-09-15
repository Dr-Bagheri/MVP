"use client";

import { useEffect, useState } from "react";
import { IconPlus, IconTrash } from "@/components/icons";
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
  /* A SHARE OF THE LANE, NOT 300 PIXELS (user ruling, 2026-09-15: "it must
     be in percentage for all sizes … everything must be fitted to the
     screen"). Measured before: four fixed columns spanned 1232px inside an
     816px column on a 1280 laptop with the assistant open, so the board
     scrolled sideways on the screen most people work at, and on a 1920
     monitor the same four columns left a third of the lane empty. Each
     column takes an equal share of the lane now, with a floor under which
     the lane scrolls — a phone gets the scroll, a laptop gets four columns
     that fit, a monitor gets four columns that fill. THE FLOOR IS 11.5rem,
     measured on production after the first cut shipped at 14: on a 1280
     laptop with the assistant open (30vw, the user's own ruling) the page
     column is 762px inside, and four columns plus three gaps fit only under
     ~182px each — 14rem was 217 and the board still scrolled on the one
     screen the ruling is about. 11rem is 170 there (the add-column strip
     takes the rest), 193 on a 1920 monitor, and a card keeps ~150px of
     text at the narrowest. */
  "glass flex min-w-[11rem] flex-1 basis-0 flex-col self-stretch rounded-2xl p-2.5 min-h-[70vh]";

export const BOARD_HEADER = "flex items-center justify-between gap-1 px-1 py-1";
export const BOARD_HEADER_START = "flex min-w-0 items-center gap-1";
export const BOARD_HEADER_END = "flex shrink-0 items-center gap-1";
export const BOARD_TITLE = "truncate text-sm font-semibold text-fg";
export const BOARD_COUNT = "badge-num rounded-md bg-surface-2 px-1.5 text-caption text-fg-subtle";

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
/**
 * THE ADD-COLUMN SLOT IS A STRIP, NOT A COLUMN (2026-09-15). It was a
 * column-wide (13.75rem) dashed box at the end of the lane, and on the 1280
 * laptop with the assistant open it was the ONE fixed width left there: the
 * four columns fit their share (748 in 762) and the slot pushed the lane
 * into a scroll by itself. It is the board's own dashed «+» now — the folder
 * strip's square, drawn column-tall — 34px wide with the label as its name,
 * so an admin still finds it at the lane's end and a member's lane (which
 * never draws it) and an admin's are the same width to within a strip.
 */
export const BOARD_ADD_COLUMN =
  "tap flex w-control-sm shrink-0 items-start justify-center self-stretch rounded-2xl border border-dashed border-border pt-4 text-fg-muted hover:border-border-strong hover:text-fg";

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
 * THE CARD'S OWN DELETE (user directive, 2026-09-15: "remove the delete
 * button for the columns so you have solid columns always, and add the small
 * delete icon on the tasks cards and projects cards").
 *
 * A column is the board's STRUCTURE and structure is not deleted from a
 * header; a card is a THING and carries its own. It is the theme's icon
 * control (R4's `.btn-icon`), quiet until the pointer reaches it and red under
 * it — and it never deletes by itself: the press hands the card to the
 * platform's ONE confirm dialog (confirm.guard). It stops the press where it
 * lands, in both senses: the card around it opens on click and lifts on hold,
 * and a delete that also opened the card would put the dialog under a panel;
 * on the projects board the card is an anchor, so the default is prevented
 * too. Rendered by BOTH boards from this module (R17) — a trash drawn twice
 * is the pair that stops matching.
 *
 * `-my-1`: the control is 28px tall beside a 20px title line; the negative
 * margins keep the row the line's height, so a card with the icon is not
 * taller than a card without it.
 *
 * The CALLER decides whether to render it: on the task board a card's delete
 * is the creator's or an admin's (db/0162), on the projects board an admin's
 * (db/0191) — and a control the server would refuse is worse than none.
 */
export function BoardCardDelete({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="btn btn-icon -my-1 shrink-0 text-fg-subtle hover:text-danger"
    >
      <IconTrash width={12} height={12} />
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
