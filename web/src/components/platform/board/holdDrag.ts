"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * PRESS, MOVE OR HOLD, RELEASE (user, 2026-09-05: "the tasks in kanban should
 * have the ability to be moved by hand to other columns … if they click it
 * will open up and if they hold they can move it"; the same evening: "moving
 * cards by hand is not working").
 *
 * The first version lifted a card ONLY after a 220ms still hold and treated
 * any earlier movement as a scroll. Synthetic events proved it end to end and
 * a hand could not use it: a person drags the moment they press, so every
 * real drag moved past the slop inside the hold window and was thrown away as
 * a scroll. Two other things that version leaned on were the wrong tools —
 * the card's own pointer handlers (a card that stops taking hits so the
 * column under it can be found also stops receiving the very events it needs,
 * unless pointer capture holds, and capture taken inside a timer is a bet)
 * and pointer capture itself. This version:
 *
 *   idle ──pointerdown──▶ pressed ──mouse/pen moves > SLOP_PX ─▶ lifted
 *                            │       or still for HOLD_MS (any pointer)
 *                            │ touch moves > SLOP_PX before the hold
 *                            ▼
 *                     idle (the browser is scrolling)
 *   lifted ──pointerup──▶ DROP on the column under the pointer
 *   lifted ──Escape / pointercancel──▶ put back
 *
 * A release before any lift is a CLICK and reaches the card's own onClick
 * untouched; after a lift the click the browser fires anyway is swallowed once
 * (`consumeClick`). From the press on, the gesture is tracked on the WINDOW,
 * so where the pointer is and what it is over no longer matter; the lifted
 * card follows the pointer by a transform written straight to its element and
 * stops taking hits, so the column under the pointer is a HIT-TEST
 * (`elementFromPoint`) through it. A mouse drags at once; a finger must hold
 * first, because a finger that moves at once is scrolling the lane.
 *
 * jsdom has no layout; the test mocks `elementFromPoint` to name the column.
 */
export const HOLD_MS = 220;
export const SLOP_PX = 6;

type Phase = "idle" | "pressed" | "lifted";

export interface HoldDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** true exactly once after a drop — the card's onClick asks before opening */
  consumeClick: () => boolean;
}

/** the column under a viewport point — null between columns or off the board */
export function columnAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y);
  return hit?.closest<HTMLElement>("[data-column]")?.dataset.column ?? null;
}

export function useHoldDrag({ onLift, onOver, onDrop, onCancel }: {
  onLift: () => void;
  onOver: (columnId: string | null) => void;
  onDrop: (columnId: string | null) => void;
  onCancel: () => void;
}): HoldDragHandlers {
  const st = useRef<{
    phase: Phase; x0: number; y0: number; pointerId: number; touch: boolean;
    timer: ReturnType<typeof setTimeout> | null; el: HTMLElement | null;
    over: string | null; swallow: boolean; detach: (() => void) | null;
  }>({ phase: "idle", x0: 0, y0: 0, pointerId: -1, touch: false, timer: null, el: null, over: null, swallow: false, detach: null });
  /* the latest callbacks, read at event time — the handlers below are stable */
  const fns = useRef({ onLift, onOver, onDrop, onCancel });
  fns.current = { onLift, onOver, onDrop, onCancel };

  /* touch scrolling has to be refused explicitly while a card is lifted: a
     lifted card that also scrolls the lane is two gestures on one finger */
  const preventScroll = useCallback((e: TouchEvent) => { e.preventDefault(); }, []);

  const putBack = useCallback(() => {
    const s = st.current;
    if (s.timer !== null) { clearTimeout(s.timer); s.timer = null; }
    if (s.detach !== null) { s.detach(); s.detach = null; }
    if (s.el !== null) { s.el.style.transform = ""; s.el.style.pointerEvents = ""; }
    window.removeEventListener("touchmove", preventScroll);
    document.body.classList.remove("select-none");
    s.phase = "idle"; s.el = null; s.over = null; s.pointerId = -1;
  }, [preventScroll]);

  const lift = useCallback(() => {
    const s = st.current;
    if (s.phase !== "pressed" || s.el === null) return;
    if (s.timer !== null) { clearTimeout(s.timer); s.timer = null; }
    s.phase = "lifted";
    s.el.style.pointerEvents = "none";
    window.addEventListener("touchmove", preventScroll, { passive: false });
    document.body.classList.add("select-none");
    fns.current.onLift();
  }, [preventScroll]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    /* a press on a control INSIDE the card is that control's — the tick box,
       a label, a menu — never the start of a lift. The card ITSELF may be a
       link (the project card is one), so the nearest control counts only
       when it is not the element the hand is on. The first version asked
       `closest("a")` without that clause and refused every press on a project
       card — a true positive the kanban test caught before it shipped. */
    const control = (e.target as Element).closest("button, a, input, textarea, [role=menu]");
    if (control !== null && control !== e.currentTarget) return;
    putBack();
    const s = st.current;
    s.phase = "pressed"; s.x0 = e.clientX; s.y0 = e.clientY;
    s.el = e.currentTarget; s.pointerId = e.pointerId; s.touch = e.pointerType === "touch";

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointerId) return;
      if (s.phase === "pressed") {
        if (Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0) <= SLOP_PX) return;
        /* a finger that moves before the hold is scrolling; a mouse or pen
           that moves is dragging — lift now rather than after the wait */
        if (s.touch) { putBack(); return; }
        lift();
      }
      if (s.phase !== "lifted" || s.el === null) return;
      s.el.style.transform = `translate3d(${ev.clientX - s.x0}px, ${ev.clientY - s.y0}px, 0)`;
      const over = columnAt(ev.clientX, ev.clientY);
      if (over !== s.over) { s.over = over; fns.current.onOver(over); }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointerId) return;
      if (s.phase === "lifted") {
        const target = columnAt(ev.clientX, ev.clientY) ?? s.over;
        putBack();
        s.swallow = true;
        fns.current.onDrop(target);
        return;
      }
      putBack(); // a click — the card's own onClick takes it from here
    };
    const onCancelEv = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointerId) return;
      const was = s.phase;
      putBack();
      if (was === "lifted") fns.current.onCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancelEv);
    s.detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancelEv);
    };
    s.timer = setTimeout(() => { s.timer = null; lift(); }, HOLD_MS);
  }, [putBack, lift]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && st.current.phase === "lifted") { putBack(); fns.current.onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); putBack(); };
  }, [putBack]);

  const consumeClick = useCallback(() => {
    const s = st.current;
    if (s.swallow) { s.swallow = false; return true; }
    return false;
  }, []);

  return { onPointerDown, consumeClick };
}
