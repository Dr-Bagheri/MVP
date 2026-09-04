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
