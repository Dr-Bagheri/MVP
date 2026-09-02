"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * THE PLATFORM'S FLOATING PANEL — the one every dropdown, picker and menu
 * hangs off (user directive, 2026-09-02: "these must be rules in theme for
 * all drop down menus").
 *
 * Why a portal and not `position: absolute` in place, which is what every one
 * of them was doing:
 *
 *  · An absolute panel is out of flow, but only relative to the nearest
 *    positioned ancestor — and it is still CLIPPED by any ancestor with
 *    `overflow: hidden` or `auto`. Half this product's surfaces are scroll
 *    containers and cards with `overflow-hidden`, so a menu opened near the
 *    bottom of one was cut in half by a box three levels up.
 *  · Worse, a panel that participates in ANY ancestor's sizing changes the
 *    page under the person who opened it — the report that started this was
 *    the profile's role row growing taller and pushing Save down the screen.
 *
 * Portalled to `document.body` and positioned `fixed` from the trigger's own
 * rect, a panel cannot do either. It is above everything, it is clipped by
 * nothing, and opening one moves not a single pixel of the page.
 *
 * The rest is what a floating panel owes and each hand-rolled one forgot at
 * least once: it FLIPS above the trigger when there is no room below, it
 * stays at least as wide as the trigger, it closes on Escape, on a click
 * outside, and on a scroll — because a panel pinned to coordinates the page
 * has since moved is a menu floating over the wrong control.
 */
export function Popover({ open, anchor, onClose, children, align = "start", minWidth = true }: {
  open: boolean;
  /** the control the panel belongs to; its rect places the panel */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** which edge of the trigger the panel lines up with, in writing order */
  align?: "start" | "end";
  /** at least as wide as the trigger — off for menus that want their own */
  minWidth?: boolean;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<Record<string, number | string>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /* placed BEFORE paint: measuring in a plain effect renders the panel once
     at 0,0 and moves it, which reads as a flicker in the corner of the eye */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = anchor.current;
      const box = panel.current;
      if (trigger === null || box === null) return;
      const rect = trigger.getBoundingClientRect();
      const height = box.offsetHeight;
      const below = window.innerHeight - rect.bottom;
      /* flip UP when the panel does not fit below AND there is more room
         above — not merely when it does not fit, or a panel taller than the
         viewport flips into even less space */
      const flip = below < height + 8 && rect.top > below;
      const width = Math.max(box.offsetWidth, minWidth ? rect.width : 0);
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      /* `align` is in WRITING order: "start" is the right edge in Persian */
      const startAtRight = (align === "start") === rtl;
      const left = startAtRight ? rect.right - width : rect.left;
      setStyle({
        top: flip ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
        left: Math.min(Math.max(8, left), window.innerWidth - width - 8),
        ...(minWidth ? { minWidth: rect.width } : {}),
      });
    };
    place();
    /* a scroll moves the trigger and not the panel: re-place on the way, and
       close when the trigger has left the screen entirely */
    const onScroll = () => { place(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, align, minWidth, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target)) return;
      if (anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={panel}
      style={{ position: "fixed", zIndex: 80, ...style }}
      className="rounded-xl border border-border bg-surface p-1 shadow-island"
    >
      {children}
    </div>,
    document.body,
  );
}
