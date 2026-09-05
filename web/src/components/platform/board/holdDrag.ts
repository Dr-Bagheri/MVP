"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * HOLD TO LIFT, RELEASE TO DROP (user, 2026-09-05: "the tasks in kanban should
 * have the ability to be moved by hand to other columns … if they click it
 * will open up and if they hold they can move it").
 *
 * The board carried the browser's own drag (`draggable` + dataTransfer). It
 * works with a mouse and nowhere else — a finger gets nothing — and even with
 * a mouse the card left the moment the pointer moved, so a press that wandered
 * a pixel on its way to a click had started a drag. This is a pointer state
 * machine instead, one for every pointer type:
 *
 *   idle ──pointerdown──▶ pressed ──still for HOLD_MS──▶ lifted ──pointerup──▶ DROP
 *                            │ moved more than SLOP_PX          │ Escape / cancel
 *                            ▼                                   ▼
 *                     idle (a scroll, or a click)          idle (put back)
 *
 * A release before the hold is a CLICK and reaches the card's own onClick
 * untouched; a release after a lift is a DROP, and the click the browser
 * fires anyway is swallowed exactly once (`consumeClick`). While lifted the
 * card follows the pointer by a transform written straight to the element
 * (no render per move) and stops taking hits itself, so the column under the
 * pointer is found by HIT-TEST — `elementFromPoint`, the instrument this
 * repo's audits trust — because a drop lands where the finger is, not where a
 * box model thinks it is. Pointer capture keeps the events arriving at the
 * card even though the card no longer takes hits.
 *
 * jsdom has no layout and no pointer capture; both are guarded, and the test
 * mocks `elementFromPoint` to say which column is under the pointer.
 */
export const HOLD_MS = 220;
export const SLOP_PX = 6;

type Phase = "idle" | "pressed" | "lifted";

export interface HoldDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
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
    phase: Phase; x0: number; y0: number; pointerId: number;
    timer: ReturnType<typeof setTimeout> | null; el: HTMLElement | null;
    over: string | null; swallow: boolean;
  }>({ phase: "idle", x0: 0, y0: 0, pointerId: -1, timer: null, el: null, over: null, swallow: false });
  /* the latest callbacks, read at event time — the handlers below are stable */
  const fns = useRef({ onLift, onOver, onDrop, onCancel });
  fns.current = { onLift, onOver, onDrop, onCancel };

  /* touch scrolling has to be refused explicitly while a card is lifted: a
     lifted card that also scrolls the lane is two gestures on one finger */
  const preventScroll = useCallback((e: TouchEvent) => { e.preventDefault(); }, []);

  const putBack = useCallback(() => {
    const s = st.current;
    if (s.timer !== null) { clearTimeout(s.timer); s.timer = null; }
    if (s.el !== null) {
      s.el.style.transform = "";
      s.el.style.pointerEvents = "";
      if (s.pointerId >= 0 && typeof s.el.releasePointerCapture === "function") {
        try { s.el.releasePointerCapture(s.pointerId); } catch { /* already gone */ }
      }
    }
    window.removeEventListener("touchmove", preventScroll);
    document.body.classList.remove("select-none");
    s.phase = "idle"; s.el = null; s.over = null; s.pointerId = -1;
  }, [preventScroll]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    /* a press on a control INSIDE the card is that control's — the tick box,
       a label, a menu — never the start of a lift */
    if ((e.target as Element).closest("button, a, input, textarea, [role=menu]")) return;
    putBack();
    const s = st.current;
    s.phase = "pressed"; s.x0 = e.clientX; s.y0 = e.clientY;
    s.el = e.currentTarget; s.pointerId = e.pointerId;
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.phase !== "pressed" || s.el === null) return;
      s.phase = "lifted";
      const el = s.el;
      if (typeof el.setPointerCapture === "function") {
        try { el.setPointerCapture(s.pointerId); } catch { /* jsdom, or the pointer is gone */ }
      }
      el.style.pointerEvents = "none";
      window.addEventListener("touchmove", preventScroll, { passive: false });
      document.body.classList.add("select-none");
      fns.current.onLift();
    }, HOLD_MS);
  }, [putBack, preventScroll]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = st.current;
    if (s.phase === "pressed") {
      /* moved before the hold: a scroll or a stray press, not a lift */
      if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > SLOP_PX) putBack();
      return;
    }
    if (s.phase !== "lifted" || s.el === null) return;
    s.el.style.transform = `translate3d(${e.clientX - s.x0}px, ${e.clientY - s.y0}px, 0)`;
    const over = columnAt(e.clientX, e.clientY);
    if (over !== s.over) { s.over = over; fns.current.onOver(over); }
  }, [putBack]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = st.current;
    if (s.phase === "lifted") {
      const target = columnAt(e.clientX, e.clientY) ?? s.over;
      putBack();
      s.swallow = true;
      fns.current.onDrop(target);
      return;
    }
    putBack(); // a click — the card's own onClick takes it from here
  }, [putBack]);

  /* the pointer left the card before the hold ended — nothing is lifted */
  const onPointerLeave = useCallback(() => {
    if (st.current.phase === "pressed") putBack();
  }, [putBack]);

  const onPointerCancel = useCallback(() => {
    const was = st.current.phase;
    putBack();
    if (was === "lifted") fns.current.onCancel();
  }, [putBack]);

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

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel, consumeClick };
}
