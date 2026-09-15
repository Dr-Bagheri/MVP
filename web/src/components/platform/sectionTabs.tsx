"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { digits } from "@/lib/format";

/**
 * THE PAGE'S TWO SUB-MENUS — one module, two tracks, one pill.
 *
 * User ruling, 2026-09-15: "inside the page we have two sub menu on the top …
 * the first and second have different design but in all pages it must
 * follow the same design for each … I want them to look like meeting top
 * menu, so change them all in other pages, and for the second one use a
 * little different color but same design."
 *
 * So the design is the MEETINGS page's segmented track — a rounded rail on the
 * recessed ground with the chosen entry LIFTED out of it as a lit pill — and
 * it is written here exactly once:
 *
 *   ROW ONE   `TAB_TRACK` + `sectionTabClass`: the grey rail, the chosen
 *             pill in the surface tone with the card shadow, ink `fg`.
 *   ROW TWO   `FILTER_TRACK` + `filterChipClass`: the SAME rail and the SAME
 *             pill, on the accent's soft tint, the chosen pill in accent ink.
 *             The "little different colour" is the ground and the ink; the
 *             geometry does not move by a pixel, so a reader who has learned
 *             one row has learned the other.
 *
 * A page composes a row out of TRACKS. A track never wraps (a rail that folds
 * onto a second line stops reading as a rail — it scrolls instead, the meeting
 * items panel's own answer), and a row of tracks wraps as UNITS, so the task
 * board's three groups fold onto a second line on a laptop with the assistant
 * open rather than tearing one group across two. Dividers go INSIDE a track
 * (`TRACK_DIVIDER`), between runs of the same menu.
 *
 * Every consumer of a tab reads its class from here — `toolbar.guard.test.ts`
 * refuses a `role="tab"` whose file does not import this module, which is what
 * makes the design SOLID rather than a rule to remember: the wrong shape has no
 * spelling.
 *
 * `TwoPane` renders a menu whose items are ADDRESSES through `TAB_TRACK` and
 * `sectionTabClass` too. The distinction between a link and a view is real (a
 * link can be bookmarked and shared; a tab cannot) and it is not visual: to a
 * reader they answer the same question about the same screen.
 */

/** row one's rail: the recessed ground, the pills' 4px of padding, never wrapping */
export const TAB_TRACK =
  "scroll-quiet flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1";

/** row two's rail: the same rail on the accent's soft tint */
export const FILTER_TRACK =
  "scroll-quiet flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl bg-accent-soft p-1";

/** a divider between two runs inside ONE track */
export const TRACK_DIVIDER = "mx-0.5 h-5 w-px shrink-0 bg-border";

/**
 * A toolbar row: the tracks at the start, wrapping as units; the row's own
 * actions (a create button, a view switch) at the end. Pages render this
 * through `Toolbar`; the strings are exported for the two files that compose
 * a row by hand around something that is not a track (a search field).
 */
export const TOOLBAR_ROW = "flex flex-wrap items-center justify-between gap-2";
export const TOOLBAR_GROUPS = "flex min-w-0 flex-wrap items-center gap-2";
export const TOOLBAR_END = "flex shrink-0 flex-wrap items-center gap-1.5";

/** the lifted pill, row one: surface tone, card shadow, `fg` ink */
export function sectionTabClass(active: boolean): string {
  return `btn btn-sm shrink-0 gap-1.5 rounded-xl font-medium ${
    active ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"
  }`;
}

/** the lifted pill, row two: the same pill, accent ink when chosen */
export function filterChipClass(active: boolean): string {
  return `btn btn-sm shrink-0 gap-1.5 rounded-xl font-medium ${
    active ? "bg-surface font-semibold text-accent shadow-card" : "text-fg-muted hover:text-fg"
  }`;
}

/**
 * An on/off filter («فقط من», «مهلت امروز») is a pill in a track that lifts
 * on its own: the same face as a tab, with `aria-pressed` rather than
 * `aria-selected`, because two of them can be on at once.
 */
export const toggleClass = sectionTabClass;

/** the count badge a pill carries */
export const FILTER_COUNT = "badge-num rounded-md bg-surface-2 px-1 text-micro";

/** THE GAP UNDER ROW TWO — the board's own `gap-3` (12px) between its second
    row and its cards. A page whose second row is not inside a `gap-3` column
    wears this instead of a number of its own. */
export const FILTER_ROW_GAP = "mb-3";
/** and the same 12 under ROW ONE where a page draws that row outside a
    `gap-3` column */
export const SECTION_ROW_GAP = "mb-3";

export function Toolbar({
  end,
  className = "",
  children,
}: {
  /** the row's own actions, at the end: the create button, a view switch */
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${TOOLBAR_ROW} ${className}`}>
      <div className={TOOLBAR_GROUPS}>{children}</div>
      {end ? <div className={TOOLBAR_END}>{end}</div> : null}
    </div>
  );
}

export interface FilterChip<K extends string> {
  key: K;
  label: ReactNode;
  /** every chip in a row carries one — a row where only some do reads as two kinds of control */
  icon: ReactNode;
  /** already formatted for the locale (`digits`) */
  count?: ReactNode;
}

export function FilterChips<K extends string>({
  label,
  chips,
  active,
  onSelect,
  className = "",
  children,
}: {
  label: string;
  chips: readonly FilterChip<K>[];
  active: K;
  onSelect: (key: K) => void;
  className?: string;
  /** the row's own extra controls after the chips — a divider, a `+` */
  children?: ReactNode;
}) {
  return (
    <div role="tablist" aria-label={label} className={`${FILTER_TRACK} ${className}`}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          role="tab"
          data-key={chip.key}
          aria-selected={chip.key === active}
          className={filterChipClass(chip.key === active)}
          onClick={() => onSelect(chip.key)}
        >
          {chip.icon}
          {chip.label}
          {chip.count !== undefined ? <span className={FILTER_COUNT}>{chip.count}</span> : null}
        </button>
      ))}
      {children}
    </div>
  );
}

export interface SectionTab<K extends string> {
  key: K;
  label: ReactNode;
  /** an optional count, rendered the way the meeting page's tabs render one */
  count?: number | undefined;
}

export function SectionTabs<K extends string>({
  label,
  tabs,
  active,
  onSelect,
  className = "",
}: {
  label: string;
  tabs: readonly SectionTab<K>[];
  active: K;
  onSelect: (key: K) => void;
  className?: string;
}) {
  const locale = useLocale();
  return (
    /*
     * `tablist`, not `navigation`: nothing here changes the address, and
     * announcing a set of view filters as navigation tells a screen-reader
     * user they are about to leave the page.
     */
    <div role="tablist" aria-label={label} className={`${TAB_TRACK} ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          /* the VALUE, for a test to name — a label is a fact about the
             catalogue, and a test that clicks by label breaks on a rewording */
          data-key={tab.key}
          aria-selected={tab.key === active}
          className={sectionTabClass(tab.key === active)}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="badge-num text-micro opacity-70">{digits(tab.count, locale)}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
