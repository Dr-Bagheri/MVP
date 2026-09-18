"use client";

import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { digits } from "@/lib/format";
import { IconChevronRight } from "@/components/icons";
import { MENU_ENTRY_CLASS, MENU_PANEL_CLASS } from "@/components/rowActions";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * THE PAGE'S TWO SUB-MENUS — one module, design «ج».
 *
 * User's choice, 2026-09-17, from three compact designs drawn side by side
 * against the toolbar of the day (which cost 104px before the first content):
 * «ج» — a SEGMENTED CONTROL for the views, the sort and the filters behind
 * two MENU buttons («مرتب‌سازی», «فیلتر» with a count of the filters that are
 * on), and the folders as one LINE of chips — 70px to the content, and the
 * only things always in view are the ones a person switches between.
 *
 * So the design is written here exactly once:
 *
 *   ROW ONE   `TAB_TRACK` + `sectionTabClass`: the segmented control — the
 *             recessed track, 3px around 28px pills (`.btn-xs`), the chosen
 *             pill lifted in the surface tone with the card shadow. The pill
 *             plus its padding is `btn-sm`'s 34, so a `ToolbarMenu` and a
 *             `btn-sm` create button stand level with it on one line.
 *   MENUS     `ToolbarMenu` + `MenuRadio` / `MenuCheck`: a ghost button at
 *             the track's height with a label, the current value where one
 *             is worth reading on the row, a COUNT of active filters, and a
 *             chevron; the panel is the ⋯ menu's own panel (rowActions.tsx).
 *   ROW TWO   `FILTER_TRACK` + `filterChipClass`: a line of `.filter-chip`s — 24
 *             tall, outlined, the accent's edge and tint when on — with no
 *             rail under them; the row costs what a line of text does.
 *
 * (2026-09-15 to 2026-09-17 the two rows were ONE geometry in two colours —
 * the meetings rail and a tinted copy of it. That is the toolbar «ج» was
 * chosen over; `filterChips.test` records the reversal.)
 *
 * A track never wraps (a rail that folds onto a second line stops reading as
 * a rail — it scrolls instead), and a row of tracks wraps as UNITS. Dividers
 * go INSIDE a track (`TRACK_DIVIDER`), between runs of the same menu.
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

/**
 * row one's segmented control: the recessed track, 2px around the pills,
 * never wrapping. The 2px is a relationship, not a taste: a 24 pill in a 2px
 * track is 28, the compact control's own height, so a `btn-sm` beside the
 * track — the menus, the row-one create — stands level with it (2026-09-18,
 * "make all button one size smaller": the pill went 28 → 24 and the padding
 * 3 → 2 with it; buttonTactile.test asserts the sum).
 */
export const TAB_TRACK =
  "track-scroll flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-[2px]";

/** row two's line of chips: no ground, no padding — the chips and their gaps */
export const FILTER_TRACK =
  "track-scroll flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto";

/** a divider between two runs inside ONE track */
export const TRACK_DIVIDER = "mx-0.5 h-5 w-px shrink-0 bg-border";

/**
 * A toolbar row: the tracks at the start, wrapping as units; the row's own
 * actions (a create button, a view switch) at the end. Pages render this
 * through `Toolbar`; the strings are exported for the two files that compose
 * a row by hand around something that is not a track (a search field).
 *
 * A BUTTON ON THE ROW IS `btn-sm` — the segmented control's own height. A
 * full `.btn` (42) beside a 34px control is the two-families-on-one-line
 * fault the 2026-09-16 round fixed the other way round; the dialogs keep
 * `.btn`, the toolbars wear `btn-sm`.
 */
export const TOOLBAR_ROW = "flex flex-wrap items-center justify-between gap-2";
export const TOOLBAR_GROUPS = "flex min-w-0 flex-wrap items-center gap-2";
export const TOOLBAR_END = "flex shrink-0 flex-wrap items-center gap-1.5";

/** the segmented pill, row one: surface tone, card shadow, `fg` ink when chosen */
export function sectionTabClass(active: boolean): string {
  return `btn btn-xs shrink-0 gap-1.5 ${
    active ? "bg-surface font-semibold text-fg shadow-card" : "text-fg-muted hover:text-fg"
  }`;
}

/** the chip, row two: outlined; the accent's edge, tint and ink when chosen */
export function filterChipClass(active: boolean): string {
  return active ? "filter-chip filter-chip-on" : "filter-chip";
}

/**
 * An on/off filter that stays ON THE ROW («مقایسه» on the call page) is a
 * segmented pill lifting on its own: the same face as a tab, with
 * `aria-pressed` rather than `aria-selected`. The page toolbars' own
 * on/off filters («فقط من», «مهلت امروز») live in the «فیلتر» menu instead —
 * design «ج» keeps only the views in permanent view.
 */
export const toggleClass = sectionTabClass;

/** the count a chip or a pill carries: a small number, no box of its own */
export const FILTER_COUNT = "badge-num text-micro opacity-70";

/** the count of ACTIVE filters on a menu button: a dot of the accent with the number in it */
export const MENU_COUNT = "badge-num h-4 min-w-4 rounded-full bg-accent px-1 text-micro text-on-accent";

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

/**
 * A MENU ON THE ROW. The trigger reads as one of the row's controls — the
 * ghost coat at `btn-sm`, the control's own height — and opens the ⋯ menu's
 * panel; its rows are `MenuRadio` (which one) and `MenuCheck` (on or off),
 * the two questions a toolbar asks. `count` is how many of the choices
 * inside are ON: a filter nobody can see is a list that lies, and the badge
 * is where the hidden ones are counted. `value` is a reading of the current
 * choice worth showing on the row itself («مرتب‌سازی: تاریخ»).
 */
export function ToolbarMenu({
  label,
  icon,
  value,
  count = 0,
  children,
}: {
  label: string;
  icon?: ReactNode;
  /** the current answer, shown after the label */
  value?: ReactNode;
  /** how many filters inside are on — drawn as a badge when above zero */
  count?: number;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn-ghost btn-sm shrink-0 gap-1.5">
          {icon}
          <span>{label}</span>
          {value !== undefined ? <span className="text-fg">{value}</span> : null}
          {count > 0 ? <span className={MENU_COUNT}>{digits(count, locale)}</span> : null}
          <IconChevronRight width={12} height={12} className="rotate-90 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className={MENU_PANEL_CLASS}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* the menu's rows wear the ⋯ menu's row (rowActions.tsx) with the space the
   indicator needs at the start; the ink lifts when the row is the chosen one */
const MENU_ROW =
  `${MENU_ENTRY_CLASS} ps-8 text-fg-muted focus:bg-surface-2 focus:text-fg data-[state=checked]:text-fg`;

/** a group heading inside a menu («اولویت») */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuLabel className="px-3 pb-1 pt-2 text-micro font-semibold text-fg-subtle">
      {children}
    </DropdownMenuLabel>
  );
}

export function MenuSeparator() {
  return <DropdownMenuSeparator className="my-1 bg-border" />;
}

export interface MenuOption<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
}

/** WHICH ONE: a radio group; choosing closes the menu */
export function MenuRadio<K extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: K;
  onChange: (key: K) => void;
  options: readonly MenuOption<K>[];
}) {
  return (
    <>
      {label ? <MenuLabel>{label}</MenuLabel> : null}
      <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as K)}>
        {options.map((option) => (
          <DropdownMenuRadioItem
            key={option.key}
            value={option.key}
            /* the VALUE, for a test to name — a label is a fact about the
               catalogue, and a test that clicks by label breaks on a rewording */
            data-key={option.key}
            className={MENU_ROW}
          >
            {option.icon}
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** ON OR OFF: a check row; toggling keeps the menu open, so two filters are one visit */
export function MenuCheck({
  checked,
  onChange,
  icon,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
      onSelect={(e) => e.preventDefault()}
      className={MENU_ROW}
    >
      {icon}
      {children}
    </DropdownMenuCheckboxItem>
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
            <span className={FILTER_COUNT}>{digits(tab.count, locale)}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
