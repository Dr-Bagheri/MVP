"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Resizable side panels (user directive, 2026-08-18): the section menu and
 * the assistant pane give width to the middle column on demand.
 *
 * The ruled numbers: **both sides min 15% and default 15%; the menu tops out
 * at 30%, the assistant at 40%.** Percent of the surface that holds them —
 * the flex row the panel sits in — so the middle section always gets the
 * remainder.
 *
 * Mechanics worth stating:
 *
 * - The width is a CSS custom property (`--panel-w`) consumed by an
 *   `md:w-[var(--panel-w)]` class. Below `md` the panels keep their stacked /
 *   overlay behaviour untouched — an inline `width` style would defeat the
 *   mobile classes, a variable only the md class reads cannot.
 *
 * - Drag math is measured, not accumulated: each move recomputes the width
 *   from the pointer's distance to the panel's ANCHORED edge (the edge that
 *   does not move). Deltas drift; distances don't — and the same code is
 *   correct in RTL, where "the leading edge" is the right one, without a
 *   single direction conditional in the math.
 *
 * - During the drag the variable is written straight onto the element
 *   (no re-render per mousemove); React state and localStorage are settled
 *   once, on release.
 *
 * - The handle is a real `role="separator"` with the ARIA value model and
 *   arrow-key resizing, because a control only pointer users can operate is
 *   half a control.
 */

export interface PanelSpec {
  /** localStorage key — the width survives reloads per device. */
  storageKey: string;
  /** Percent of the containing row. */
  defaultPct: number;
  minPct: number;
  maxPct: number;
}

/** The ruled specs, exported so every surface uses the same numbers. */
export const MENU_PANEL: PanelSpec = {
  storageKey: "neurai_panel_menu",
  defaultPct: 15,
  minPct: 15,
  maxPct: 30,
};

export const ASSISTANT_PANEL: PanelSpec = {
  storageKey: "neurai_panel_assistant",
  defaultPct: 15,
  minPct: 15,
  maxPct: 40,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readStored(spec: PanelSpec): number {
  try {
    const raw = window.localStorage.getItem(spec.storageKey);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, spec.minPct, spec.maxPct) : spec.defaultPct;
  } catch {
    return spec.defaultPct;
  }
}

/**
 * A panel on one side of a flex row, plus its drag handle.
 *
 * `side` is LOGICAL — "start" for a panel at inline-start (the section menu),
 * "end" for one at inline-end (the assistant). The handle renders on the
 * panel's inner edge: after a start panel, before an end panel.
 */
export function ResizablePanel({
  side,
  spec,
  label,
  className = "",
  children,
}: {
  side: "start" | "end";
  spec: PanelSpec;
  /** Accessible name for the separator ("تغییر اندازهٔ منو"…). */
  label: string;
  /** Extra classes for the panel wrapper (borders live with the caller). */
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // SSR renders the default; the stored width applies on mount (no viewport
  // or storage exists server-side, and a hydration mismatch flashes anyway).
  const [pct, setPct] = useState(spec.defaultPct);

  useEffect(() => {
    setPct(readStored(spec));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spec is constant per mount
  }, []);

  const commit = useCallback(
    (value: number) => {
      const next = clamp(value, spec.minPct, spec.maxPct);
      setPct(next);
      try {
        window.localStorage.setItem(spec.storageKey, String(next));
      } catch {
        // a private-mode quota failure costs persistence, not resizing
      }
    },
    [spec],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const panel = panelRef.current;
      const container = panel?.parentElement;
      if (!panel || !container) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const rtl = getComputedStyle(container).direction === "rtl";
      let livePct = pct;

      const widthAt = (clientX: number): number => {
        const rect = panel.getBoundingClientRect();
        const total = container.getBoundingClientRect().width;
        if (total === 0) return livePct;
        /*
         * Distance from the pointer to the panel's anchored (outer) edge.
         * start panel: anchored at inline-start — left in LTR, right in RTL.
         * end panel:   anchored at inline-end   — right in LTR, left in RTL.
         */
        const anchorLeft = side === "start" ? !rtl : rtl;
        const px = anchorLeft ? clientX - rect.left : rect.right - clientX;
        return clamp((px / total) * 100, spec.minPct, spec.maxPct);
      };

      const onMove = (move: PointerEvent) => {
        livePct = widthAt(move.clientX);
        panel.style.setProperty("--panel-w", `${livePct}%`);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        commit(livePct);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [commit, pct, side, spec],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      /*
       * Arrows move the EDGE the handle sits on, in screen space: whichever
       * arrow points away from the panel grows it. Resolved per side and
       * direction so the key always does what the screen suggests.
       */
      const grow =
        event.key === (side === "start" ? (rtl ? "ArrowLeft" : "ArrowRight") : rtl ? "ArrowRight" : "ArrowLeft");
      const shrink =
        event.key === (side === "start" ? (rtl ? "ArrowRight" : "ArrowLeft") : rtl ? "ArrowLeft" : "ArrowRight");
      if (!grow && !shrink) return;
      event.preventDefault();
      commit(pct + (grow ? 1 : -1));
    },
    [commit, pct, side],
  );

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={spec.minPct}
      aria-valuemax={spec.maxPct}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none select-none md:block"
    >
      {/* the visible grip: a hairline that thickens on hover/focus */}
      <div className="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-[3px] group-hover:bg-border-strong group-focus-visible:w-[3px] group-focus-visible:bg-accent rtl:translate-x-1/2" />
    </div>
  );

  const panel = (
    <div
      ref={panelRef}
      style={{ "--panel-w": `${pct}%` } as React.CSSProperties}
      className={`md:w-[var(--panel-w)] md:shrink-0 ${className}`}
    >
      {children}
    </div>
  );

  return side === "start" ? (
    <>
      {panel}
      {handle}
    </>
  ) : (
    <>
      {handle}
      {panel}
    </>
  );
}
