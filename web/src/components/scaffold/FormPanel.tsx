import { Children, cloneElement, isValidElement, type ReactNode } from "react";

/**
 * M26 scaffold — the one card shape every form row lives in.
 *
 * Anatomy (from the approved blueprint, Supabase's FormPanel/FormSection
 * measurements): bordered panel, radius 8, rows on a 5/7 grid — label +
 * description at inline-start, control at inline-end — hairlines BETWEEN
 * rows (never around them), footer with actions at inline-end.
 *
 * The rows are divided by the PANEL (divide-y), not by each row knowing
 * whether it is first — so reordering rows cannot break the hairlines.
 */

export function FormPanel({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {children}
    </div>
  );
}

/**
 * One label-start / control-end row. Stacks below lg (the blueprint's grid
 * collapses on narrow screens); 24×32 padding from md up, one notch tighter
 * below.
 *
 * **The description is NOT inside the <label>.** A hint nested in the label
 * becomes part of the control's accessible NAME — announced whole on every
 * focus, and unmatchable by an exact-name query (the field/hint ruling; this
 * file's own first draft made the mistake and the exact-name test caught it).
 * Instead the description gets an id, and when the control is a single
 * element it is cloned with `aria-describedby` pointing at it — skipped
 * rather than guessed for multi-element children, and never overriding a
 * describedby the caller already set.
 */
export function FormRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const descId = htmlFor && description ? `${htmlFor}-desc` : undefined;

  let control = children;
  if (descId) {
    const kids = Children.toArray(children);
    if (kids.length === 1 && isValidElement(kids[0])) {
      const only = kids[0] as React.ReactElement<{ "aria-describedby"?: string }>;
      if (!only.props["aria-describedby"]) {
        control = cloneElement(only, { "aria-describedby": descId });
      }
    }
  }

  return (
    <div className="grid gap-3 px-5 py-4 md:px-8 md:py-6 lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm text-fg">
            {label}
          </label>
        ) : (
          <span className="block text-sm text-fg">{label}</span>
        )}
        {description ? (
          <span id={descId} className="mt-0.5 block text-detail text-fg-muted">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2 lg:col-span-7">{control}</div>
    </div>
  );
}

/**
 * The actions bar. Lives INSIDE FormPanel (the divide-y draws its top
 * hairline); primary action at inline-end, per the blueprint.
 */
export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 bg-surface px-5 py-4 md:px-8">
      {children}
    </div>
  );
}
