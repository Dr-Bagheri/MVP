"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The connectors screen is the first place in the app that needs a modal, so
 * this is a local primitive rather than a shared one — it moves to
 * `components/ui.tsx` the day a second screen wants it, and not before.
 *
 * `dismissible` is the whole reason it exists. A dialog showing a secret that
 * can never be shown again must NOT close on Escape, on a backdrop click, or
 * on anything else the hand does by reflex: those gestures mean "I'm done
 * looking", and here they would mean "destroy the only copy". So the secret
 * dialogs pass `dismissible={false}` and hand the user exactly one way out,
 * which they have to aim at. Every other dialog behaves normally.
 *
 * Focus is trapped deliberately, which is the one keyboard trap that is
 * correct: while a modal is open the rest of the page is inert, and tabbing
 * out of it would put focus somewhere the user cannot see.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  /** Ignored while `dismissible` is false — the content owns the exit then. */
  onClose: () => void;
  title: string;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  /*
   * `onClose` through a ref, and the effect below depends on [open, dismissible]
   * ONLY.
   *
   * Callers pass an inline arrow, so `onClose` is a new function on every parent
   * render — and the parent re-renders on every keystroke, because the form
   * fields are its state. With `onClose` in the dependency array the effect tore
   * down and set up again after each character typed: the cleanup restored focus
   * to the button that opened the dialog and the setup moved it to the first
   * field, so the name input lost focus after exactly one letter. Caught by
   * reading, not by typecheck — a stale-closure guard that becomes a
   * focus-stealing loop is the standard cost of putting a callback in a
   * dependency array.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // First focusable inside the panel, so a keyboard user starts in the
    // dialog rather than at the top of the page behind it.
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return (
    <div
      // A named step on the z-scale, not an arbitrary large number: the
      // assistant pane and the sidebar share this stacking context.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-[min(34rem,100%)] overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-bold text-fg">{title}</h2>
        {children}
      </div>
    </div>
  );
}
