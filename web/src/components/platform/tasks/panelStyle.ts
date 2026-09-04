/**
 * THE REFERENCE'S TASK PANELS, MEASURED (2026-09-05).
 *
 * User directive: "rebuild some parts that are important, and exactly like
 * this — the size of everything from font to dividers to button size … use
 * the style you see in their site, use the browser and inspect the code to
 * get it."
 *
 * So it was measured rather than eyeballed. Every number below is a computed
 * style read off `panel.arameet.ir` while signed in, at a 1920×911 viewport,
 * on 2026-09-05 — the new-task dialog at `/tasks` and the detail modal at
 * `/tasks?task=836`. The conditions travel with the numbers because that is
 * what makes them a recorded observation rather than a value that rots.
 *
 * ── WHAT THE MEASUREMENT SETTLED ──────────────────────────────────────────
 *
 * Their panels are 18px, not our 20 — read twice, on the dialog and on the
 * detail. That one is a TOKEN and is fixed at `SCAFFOLD.radius.modal`, since
 * a per-file radius is how a product ends up with four of them.
 *
 * The rest are panel-shaped and live here: they belong to these three
 * surfaces and to nothing else, and writing them as one exported object is
 * what keeps the new-task dialog, the task detail and the project detail from
 * drifting apart the first time one of them gains a field.
 *
 *   dialog panel      580 × auto     radius 18   bg surface   border white 17%
 *                     shadow rgba(0,0,0,.46) 0 6px 28px, body inset 24px
 *   detail panel      980 × 760      radius 18   same border and shadow
 *   detail rail       283 wide
 *
 *   dialog title      15px / 700
 *   dialog subtitle   12px / 400     fg-subtle
 *   detail title      17px / 700
 *
 *   field label       11.5px / 600   fg-subtle   margin-bottom 7px
 *   rail label        11px   / 600   fg-subtle   margin-bottom 7px
 *   rail value        12.5px / 600   fg when set, fg-subtle when empty
 *   body heading      11.5px / 700   fg-subtle
 *   body text         12.5px         line-height 23.75 (1.9)
 *
 *   input / textarea  h 45   13.5px  radius 11   bg field   border white 9%
 *   segment chip      h 34   12px    radius 9    selected = accent 16% + accent
 *   footer cancel     h 42   13px    radius 11   border white 17%
 *   footer primary    h 40   13px    radius 11
 *   top-bar button    h 27–30 11–11.5px radius 8
 *   tab bar           h 42   bg field  radius 11  padding 4  border white 9%
 *   tab               h 32   12px    radius 8    active = surface ground
 *
 * ── WHY CLASS STRINGS AND NOT A COMPONENT ─────────────────────────────────
 *
 * Each of these is one line of chrome around markup that differs per field —
 * a `<Label>` component would take a child, a size and a tone and be longer
 * than the string it replaced. What must not diverge is the NUMBER, and a
 * shared constant holds that without inventing a wrapper for every row.
 */

/** the label above a control in a dialog */
export const FIELD_LABEL =
  "mb-[7px] block text-[11.5px] font-semibold text-fg-subtle";

/** the label above a value in the detail's rail */
export const RAIL_LABEL =
  "mb-[7px] block text-[11px] font-semibold text-fg-subtle";

/** a rail value that is SET */
export const RAIL_VALUE = "text-[12.5px] font-semibold text-fg";

/** a rail value that is empty — the same size, receded, so the row still
    reads as a row rather than disappearing */
export const RAIL_EMPTY = "text-[12.5px] font-semibold text-fg-subtle";

/** a section heading inside the detail's body — 700, one step heavier than
    the dialog's field labels, which is what separates a SECTION from a field */
export const BODY_HEADING = "text-[11.5px] font-bold text-fg-subtle";

/** prose inside the detail — the 1.9 line-height is measured, not chosen */
export const BODY_TEXT = "text-[12.5px] leading-[1.9] text-fg-muted";

/** the 45px field. `.input` carries the ground, the border and the corner;
    only the height and the type size are the reference's own. */
export const PANEL_INPUT = "input h-[45px] w-full text-[13.5px]";

/** the same field grown for prose */
export const PANEL_TEXTAREA = "input min-h-[73px] w-full resize-y py-[11px] text-[13.5px]";

/**
 * A SEGMENT CHIP — column, priority, and any other closed choice.
 *
 * 9px, which is neither our control (11) nor our panel (12) radius: the
 * reference gives its small closed choices their own corner, and the two
 * states differ by ground and edge rather than by size, so the row does not
 * move when the selection does.
 */
export const chipClass = (on: boolean): string =>
  `btn h-[34px] rounded-[9px] px-3 text-[12px] font-semibold ${
    on
      ? "border border-accent bg-accent-soft text-accent"
      : "border border-border bg-field text-fg-muted hover:text-fg"
  }`;

/** the dialog's two footer controls */
export const FOOTER_CANCEL =
  "btn h-[42px] rounded-[11px] border border-border-strong px-4 text-[13px] font-semibold text-fg-muted hover:text-fg";
export const FOOTER_PRIMARY =
  "btn h-[40px] rounded-[11px] bg-accent px-[18px] text-[13px] font-semibold text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50";

/** a small control in the detail's top bar */
export const TOP_BUTTON =
  "btn h-[30px] gap-1.5 rounded-[8px] border border-border-strong px-3 text-[11.5px] font-semibold text-fg-muted hover:text-fg";

/** the two-tab strip under the body */
export const TAB_BAR =
  "flex h-[42px] items-center gap-1 rounded-[11px] border border-border bg-field p-1";
export const tabClass = (on: boolean): string =>
  `btn h-[32px] flex-1 rounded-[8px] text-[12px] font-semibold ${
    on ? "bg-surface text-fg" : "text-fg-subtle hover:text-fg"
  }`;

/** the panel itself — 580 for the dialog, 980 for the detail */
export const DIALOG_WIDTH = "w-[580px] max-w-[calc(100vw-2rem)]";
export const DETAIL_WIDTH = "w-[980px] max-w-[calc(100vw-2rem)]";
/** the detail's rail */
export const DETAIL_RAIL = "w-[283px] shrink-0";
/** the inset the reference gives a panel's body */
export const PANEL_INSET = "px-6";
