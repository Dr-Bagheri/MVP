"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * The platform's modal shell — now a thin cap over shadcn's Dialog.
 *
 * The API is UNCHANGED on purpose. Twenty-odd screens call this, and the swap
 * is worth nothing if it also asks each of them to change: a refactor that
 * touches every caller is a refactor whose regressions are everywhere. What
 * changes is underneath, and it is what a hand-rolled modal never had —
 * a focus trap, focus returned to whatever opened it, `aria-modal` and the
 * inert background wired by Radix, the scroll lock, and Escape handled by the
 * same code that handles the scrim.
 *
 * `md` came down a step earlier (2026-09-02): the new-meeting form is a title,
 * a description and two short fields, and at 576px they stretched across a
 * line far longer than anything they hold.
 */
const WIDTH = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl" } as const;

export function Overlay({ children, onClose, label, wide = false, size }: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  /** @deprecated pass `size` — kept so every existing caller still reads true */
  wide?: boolean;
  size?: keyof typeof WIDTH;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        aria-label={label}
        /* the shadcn content ships a close button of its own; ours are drawn
           by the callers, in their own header, so it is hidden rather than
           doubled — two X buttons in one corner is the two-spellings defect
           at its smallest */
        className={`${WIDTH[size ?? (wide ? "lg" : "sm")]} max-h-[88vh] gap-0 overflow-hidden rounded-2xl border-border bg-surface p-4 shadow-island [&>button:last-child]:hidden`}
      >
        <div className="flex max-h-[calc(88vh-2rem)] min-h-0 flex-col">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
