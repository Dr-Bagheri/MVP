"use client";

import type { ReactNode } from "react";

/**
 * THE PLATFORM'S ONE SUB-MENU.
 *
 * `TwoPane` turned every section menu into a top toolbar (2026-09-02), and
 * pages then started needing the same row for something that is NOT a route:
 * Integrations wants Available / Connected, Workflows wants Active / Library,
 * and the library wants a second row to sort by kind (user directive,
 * 2026-09-04). Each of those could have hand-rolled a strip of buttons, and
 * three hand-rolled strips is how a product ends up with three sub-menus that
 * are almost the same size.
 *
 * So the class is exported and both spellings use it: `TwoPane` for a menu
 * whose items are ADDRESSES, this component for a menu whose items are a view
 * of the page you are already on. The distinction is real and worth keeping —
 * a link changes the URL and can be bookmarked and shared; a tab cannot — but
 * they must not LOOK different, because to a reader they answer the same
 * question about the same screen.
 */
export function sectionTabClass(active: boolean): string {
  return `btn btn-sm gap-1.5 font-medium ${
    active
      ? "bg-accent text-on-accent"
      : "text-fg-muted hover:bg-surface-2 hover:text-fg"
  }`;
}

/**
 * THE SECOND ROW (user ruling, 2026-09-05: "the style for the second sub menu
 * of the top is different — fill with icon like in meetings; make it a rule,
 * add it in the theme and apply it for all the platform"). Row one is the
 * plain tab above; the row under it is a FILTER CHIP: an outlined control
 * carrying an icon, its label and, where one exists, a count — soft-filled in
 * the accent when it is the active filter. Tasks and meetings drew it first
 * (their folder strips); this is that chip as a class and a component, so
 * security, the audit log and the workflow shelf wear the same one rather
 * than the row-one tab a step above.
 */
export function filterChipClass(active: boolean): string {
  return `btn btn-sm gap-1.5 border font-medium ${
    active
      ? "border-accent bg-accent-soft font-semibold text-accent"
      : "border-border text-fg-muted hover:text-fg"
  }`;
}

/** the count badge a filter chip carries, as the folder strips draw it */
export const FILTER_COUNT = "badge-num rounded-md bg-surface-2 px-1 text-[10px]";

export interface FilterChip<K extends string> {
  key: K;
  label: ReactNode;
  /** every chip in the row carries one — a row where only some do reads as two kinds of control */
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
    <div role="tablist" aria-label={label} className={`flex flex-wrap items-center gap-1.5 ${className}`}>
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
  return (
    /*
     * `tablist`, not `navigation`: nothing here changes the address, and
     * announcing a set of view filters as navigation tells a screen-reader
     * user they are about to leave the page.
     */
    <div role="tablist" aria-label={label} className={`flex flex-wrap items-center gap-1 ${className}`}>
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
            <span className="badge-num text-[10px] opacity-70">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
