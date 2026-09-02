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
  /* rounded-2xl: the reference's card radius (20px), the same one every
     tile and dialog wears — a form panel at 12px beside cards at 20px was
     the one square-ish box on a page of round ones */
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
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
    /*
     * LABEL AND CONTROL CLOSE TOGETHER (user directive, 2026-09-02, on the
     * org form: labels sat at one edge of a 1240px row and their fields at
     * the other — "a failure that gets worse the wider the card gets").
     *
     * The 5/7 twelve-column grid was the cause: it divides whatever width
     * the row has, so on a wide row the label column and the control column
     * each became a small object floating in a large box. The reference's
     * rule, which Lovable reproduced from the measurements: the label column
     * is a FIXED 160px and the control is CAPPED at 380px, with 24px between
     * them. Neither depends on the row's width, so a label sits beside its
     * control on every screen and reading a field means crossing 24px, not
     * a monitor. Below md the two still stack.
     */
    <div className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-start md:gap-6">
      <div className="shrink-0 md:w-[160px] md:pt-2">
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
      <div className="flex w-full min-w-0 items-center gap-2 md:max-w-[380px]">{control}</div>
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
