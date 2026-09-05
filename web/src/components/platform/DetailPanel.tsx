"use client";

import type { ReactNode } from "react";
import { IconClose } from "@/components/icons";
import { PANEL_SECTIONS, RAIL_SECTIONS } from "./tasks/panelStyle";

/**
 * THE DETAIL PANEL — one frame for everything that opens over a list.
 *
 * User ruling, 2026-09-05 (R18): "when you click on a project it should open a
 * pop-up window, not change the page — this problem is systematic." The task
 * detail already opened this way and the project detail was a PAGE wearing the
 * same anatomy drawn a second time; two drawings of one frame are the pair
 * that stops matching the first time either gains a row. Both read this
 * component now, and the next detail (an agent, a member, a workflow) gets the
 * frame by using it rather than by copying it.
 *
 * The frame is the reference's task modal, measured (panelStyle.ts,
 * 2026-09-05): one card with the panel corner, a top bar carrying the close and
 * the acts, then a body and a 283px rail with a hairline between them and NO
 * tinted ground on the rail — so the eye reads one card with two columns
 * rather than two panels sitting beside each other.
 *
 * SLOTS rather than a prop per button: `start` is the cluster beside the close
 * (the ⋯ menu, the edit toggle), `end` is the context acts on the other side
 * (a link out, the panel's one primary act), `notice` is the alert line under
 * the bar, `rail` is the 283px column. What a panel SAYS is its own; where it
 * says it is this file's.
 */
export function DetailPanel({ label, closeLabel, onClose, start, end, notice, rail, children }: {
  label: string;
  closeLabel: string;
  onClose: () => void;
  start?: ReactNode;
  end?: ReactNode;
  notice?: ReactNode;
  rail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bg/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="my-6 flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-island"
      >
        {/* ── the top bar: close and the acts ─────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="btn btn-icon text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <IconClose width={14} height={14} />
            </button>
            {start}
          </div>
          <div className="flex items-center gap-1.5">{end}</div>
        </div>

        {notice}

        {/* ── body, then the rail — SECTIONS DIVIDED (2026-09-05) ─────────
            Each child of the body and each child of the rail is a section,
            and the hairline between them is the container's (panelStyle):
            "they all seem connected" was a rail of six fields with air and
            no lines between them. */}
        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[1fr_283px]">
          <div className={`min-h-0 p-5 ${PANEL_SECTIONS}`}>{children}</div>
          <aside className={`border-t border-border p-5 md:border-s md:border-t-0 ${RAIL_SECTIONS}`}>{rail}</aside>
        </div>
      </div>
    </div>
  );
}
