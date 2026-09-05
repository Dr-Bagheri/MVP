import { Children, cloneElement, isValidElement, type ReactNode } from "react";

/**
 * M26 scaffold — the one card shape every form row lives in.
 *
 * Anatomy: bordered panel, label + description at inline-start and control at
 * inline-end, hairlines BETWEEN rows (never around them), footer with actions
 * at inline-end.
 *
 * audit finding, 2026-09-03: the sentence that stood here still quoted the
 * blueprint's FIRST measurements — "radius 8, rows on a 5/7 grid, 24×32
 * padding" — and this file had drawn none of the three for weeks (the radius
 * moved to the card's 20, the grid was replaced by the fixed 160/380 row, and
 * the rows are px-5 py-4 at every width). That is not a cosmetic slip: the
 * footer's own gutter had frozen at the blueprint's 32 while the rows moved,
 * so the prose describing the artifact and the artifact itself drifted apart
 * together. The anatomy says what the component IS, and each move keeps its
 * reason at the line where it happened.
 *
 * The rows are divided by the PANEL (divide-y), not by each row knowing
 * whether it is first — so reordering rows cannot break the hairlines.
 */

export function FormPanel({ children }: { children: ReactNode }) {
  /* rounded-2xl: the reference's card radius (20px), the same one every
     tile and dialog wears — a form panel at 12px beside cards at 20px was
     the one square-ish box on a page of round ones */
  return (
    <div className="card divide-y divide-border overflow-hidden p-0">
      {children}
    </div>
  );
}

/**
 * One label-start / control-end row. Stacks below md, and carries the panel's
 * gutter: `px-5 py-4` at EVERY width — the blueprint's 24×32 went out with the
 * 5/7 grid it belonged to (see the layout note below).
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
  /* audit finding, 2026-09-03: `md:px-8` was a frozen copy of the panel's OLD
     32px gutter. FormRow took the fixed-160/380 layout and moved to `px-5`,
     and nothing moved the footer with it — so from md up the save button sat
     12px further in than every label it stands under, on the one row whose
     whole job is to line up with the form it closes. The footer takes the
     rows' gutter because it sits under the rows; if that gutter ever changes,
     it changes here and at FormRow together. */
  return (
    <div className="flex items-center justify-end gap-2 bg-surface px-5 py-4">
      {children}
    </div>
  );
}
