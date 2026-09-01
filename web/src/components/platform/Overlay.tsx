"use client";

import { useEffect, type ReactNode } from "react";

/**
 * The platform's modal shell (extracted from TaskBoard when Meetings needed
 * the same one — the second copy is the one nobody makes): a click on the
 * scrim or Escape closes; the panel stops the click.
 */
export function Overlay({ children, onClose, label, wide = false }: {
  children: ReactNode; onClose: () => void; label: string; wide?: boolean;
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
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
