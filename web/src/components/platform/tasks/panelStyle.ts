import { TAB_TRACK, sectionTabClass } from "../sectionTabs";

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
  "mb-[7px] block text-[0.71875rem] font-semibold text-fg-subtle";

/** the label above a value in the detail's rail */
export const RAIL_LABEL =
  "mb-[7px] block text-caption font-semibold text-fg-subtle";

/** a rail value that is SET */
export const RAIL_VALUE = "text-detail font-semibold text-fg";

/** a rail value that is empty — the same size, receded, so the row still
    reads as a row rather than disappearing */
export const RAIL_EMPTY = "text-detail font-semibold text-fg-subtle";

/** a section heading inside the detail's body — 700, one step heavier than
    the dialog's field labels, which is what separates a SECTION from a field */
export const BODY_HEADING = "text-[0.71875rem] font-bold text-fg-subtle";

/** prose inside the detail — the 1.9 line-height is measured, not chosen */
export const BODY_TEXT = "text-detail leading-[1.9] text-fg-muted";

/** the 45px field. `.input` carries the ground, the border and the corner;
    only the height and the type size are the reference's own. */
/* THE FIELD'S OWN HEIGHT (2026-09-17). This pinned 45 — the reference PANEL's
   field, measured 2026-09-05 — while `.input` is 40, the reference PAGE's
   field measured 2026-09-02: two measurements of one product, and the
   new-task dialog rendered its title field at 42 beside its folder dropdown
   at 38. One field, one height; the panel keeps only its type size. */
export const PANEL_INPUT = "input w-full text-menu-item";

/** the same field grown for prose */
export const PANEL_TEXTAREA = "input min-h-[4.5625rem] w-full resize-y py-[0.6875rem] text-menu-item";

/*
 * ── THE CONTROLS TAKE THE FAMILY (R4, user ruling 2026-09-05: "go with a") ──
 *
 * The first version of this file wrote the reference's control heights by
 * hand — `h-[34px]` on the chips, `h-[32px]` on the tabs, `h-[1.875rem]` on the
 * top-bar button, 42/40 on the footer — and NOT ONE OF THEM REACHED THE
 * SCREEN. `.btn` carries `min-h-control` (38, 41.6 at 1920), and min-height
 * beats a smaller height written beside it, so every one of these rendered at
 * the regular size: chips measured 42 on production, tabs measured 42 inside a
 * 42 bar, edge to edge. panelStyle.test asserted the STRINGS and was green the
 * whole time — the artifact read as satisfied and only the computed value
 * disagreed, one more instance of the class this repo keeps meeting.
 *
 * The ruling settles the shape rather than the numbers: the platform has
 * THREE control sizes — `.btn` 38, `.btn-sm` 34, `.btn-icon` 28 — and a
 * height written by hand on a control is a defect. The reference's 30 / 32 /
 * 34 round into 34; its 40 / 42 round into 38; its 9px chip corner rounds into
 * the family's 8, the same way. What these constants keep is the panel's
 * GROUND and EDGE semantics: a chip's two states differ by colour and border
 * and never by size, a tab's active state is the surface ground, the top-bar
 * button is outlined. The control guard now fails any `btn` that re-sizes
 * itself, so this cannot drift back by hand.
 */

/** A SEGMENT CHIP — column, priority, and any other closed choice. The two
    states differ by ground and edge, never by size, so the row does not move
    when the selection does. */
export const chipClass = (on: boolean): string =>
  `btn btn-sm ${
    on
      ? "border border-accent bg-accent-soft text-accent"
      : "border border-border bg-field text-fg-muted hover:text-fg"
  }`;

/** the dialog's two footer controls — the regular size, like every footer */
/* THE PAGE KIT'S SECONDARY, not an outline of its own (2026-09-17). This
   constant said `border border-border-strong` while `.btn-secondary` on every
   page said filled grey — the dialog kit and the page kit disagreeing about
   what a secondary button is, which is the disconnect the user could feel
   without being able to name. One coat, written in globals.css. */
export const FOOTER_CANCEL = "btn-secondary";
export const FOOTER_PRIMARY = "btn-primary";
/* a dialog's NAME — the one spelling (globals.css `.h-dialog`), read by every
   Overlay and by the detail panel's top bar, so the two cannot drift */
export const DIALOG_TITLE = "h-dialog";

/** the two-tab strip under the body. The bar has NO height of its own: it is
    the compact control plus 4px of padding on each side (34 + 8 = 42, the
    reference's bar), so it grows with the root exactly as the tabs do. */
/*
 * THE KIT'S TRACK, INSIDE A PANEL TOO (2026-09-15). This bar was the
 * reference's own — a bordered field-ground strip on the control corner —
 * and the user's ruling that every sub-menu wears the meetings track makes
 * a tab strip inside a dialog no exception: a reader who has learned the
 * pill on the page finds the same pill in the panel. The two consumers
 * (TaskDetail's comments/history, TaskViews' month/week/day) keep `flex-1`
 * because their strips fill a row rather than sit in one.
 */
export const TAB_BAR = TAB_TRACK;
export const tabClass = (on: boolean): string => `${sectionTabClass(on)} flex-1`;

/** the panel itself — 580 for the dialog, 980 for the detail, in rem so
    both grow with the root the way every other size here does */
export const DIALOG_WIDTH = "w-[36.25rem] max-w-[calc(100vw-2rem)]";
export const DETAIL_WIDTH = "w-[61.25rem] max-w-[calc(100vw-2rem)]";
/** the detail's rail */
export const DETAIL_RAIL = "w-[17.6875rem] shrink-0";
/** the inset the reference gives a panel's body */
export const PANEL_INSET = "px-6";

/*
 * ── SECTIONS ARE DIVIDED (user directive, 2026-09-05: "add divider between
 * different sections in all pop-up windows — they all seem connected; even if
 * they don't have information in them, put empty space for the parts that
 * need it, give the structure") ─────────────────────────────────────────────
 *
 * One rhythm for every panel: a hairline between sections and the same air on
 * both sides of it, drawn by the CONTAINER (`divide-y` plus a per-child
 * padding) rather than by each section — so a section cannot forget the rule
 * and reordering sections cannot break the lines. Three containers, three
 * tunings, and `dialogSections.guard.test.ts` keeps every dialog on one of
 * them.
 */
/** a dialog's scrolling body: each field a section */
export const DIALOG_BODY =
  "scroll-quiet min-h-0 flex-1 overflow-y-auto pe-1 divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-2 [&>*:last-child]:pb-1";
/** the detail panel's body: the title, then each section */
export const PANEL_SECTIONS =
  "divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0";
/** the detail panel's 283 rail: each field a section, tighter than the body */
export const RAIL_SECTIONS =
  "divide-y divide-border [&>*]:py-3.5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0";
/** an empty section keeps its room — «موردی ندارد» sits in the space the items
    would take, so the structure does not collapse around a missing answer */
export const SECTION_EMPTY = "min-h-[3rem]";
