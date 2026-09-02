"use client";

import { useEffect, type ReactNode } from "react";

/**
 * The platform's modal shell (extracted from TaskBoard when Meetings needed
 * the same one — the second copy is the one nobody makes): a click on the
 * scrim or Escape closes; the panel stops the click.
 */
/**
 * `md` exists because the two sizes were not enough: a single column of
 * stacked fields in a 768px panel leaves every input stretched across a line
 * far longer than its content, which is what "the size of the pop up boxes
 * are not right" was pointing at. A form gets `md`; a two-pane surface gets
 * `lg`; a short confirmation keeps `sm`.
 */
const WIDTH = { sm: "max-w-lg", md: "max-w-xl", lg: "max-w-3xl" } as const;

export function Overlay({ children, onClose, label, wide = false, size }: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  /** @deprecated pass `size` — kept so every existing caller still reads true */
  wide?: boolean;
  size?: keyof typeof WIDTH;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-island ${
          WIDTH[size ?? (wide ? "lg" : "sm")]
        }`}
      >
        {children}
      </div>
    </div>
  );
}
