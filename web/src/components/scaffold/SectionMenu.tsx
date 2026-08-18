"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { MENU_PANEL, ResizablePanel } from "./Resizable";

/**
 * M26 scaffold — the section menu: 256px at inline-start of the content,
 * grouped pill items, 17px pane title.
 *
 * Group labels are 11px in --fg-subtle with NO letter-spacing — tracking
 * breaks the joined Persian script, so the label recedes by size and color
 * only (the round-2 grouped-menu ruling, restated by the blueprint). The
 * relationship subtle < muted is asserted by verify-pairs.mjs.
 *
 * Below md the menu renders full-width above the content (no drawer to pick
 * a side, same reasoning as the rail) and items keep the 44px `.tap` area.
 */

export interface MenuItem {
  slug: string;
  href: string;
  label: string;
  /** A currently unavailable destination remains visible but cannot be opened. */
  disabled?: boolean;
  /**
   * Short chip beside the label — for a section that is named but not yet
   * usable. Marked IN the menu, not after you click: finding out a section
   * is empty by opening it is the experience the marker exists to prevent.
   */
  badge?: string;
}

export interface MenuGroup {
  key: string;
  title: string;
  items: readonly MenuItem[];
}

export function SectionMenu({
  navLabel,
  heading,
  groups,
  activeSlug,
}: {
  navLabel: string;
  heading: string;
  groups: readonly MenuGroup[];
  activeSlug: string;
}) {
  return (
    /*
     * `w-full`, not `md:w-menu` — since the panels became resizable
     * (2026-08-18) the WIDTH belongs to MenuLayout's ResizablePanel wrapper,
     * and this nav fills whatever the wrapper grants. `w-menu` (16rem) stays
     * in the theme as the fixed fallback for menus rendered outside a
     * resizable row.
     */
    <nav aria-label={navLabel} className="h-full w-full px-3 pb-4 md:border-e md:border-border">
      <h1 className="px-3 pb-2 pt-4 text-pane-title font-semibold text-fg">{heading}</h1>
      {groups.map((group, i) => (
        <div key={group.key}>
          {i > 0 ? <hr className="mx-3 my-3.5 border-border" /> : null}
          <p className="mb-1.5 mt-4 px-3 text-group-label font-medium text-fg-subtle">
            {group.title}
          </p>
          <ul>
            {group.items.map((item) => {
              const active = item.slug === activeSlug;
              const itemClass = `tap my-px flex w-full items-center justify-between rounded-lg px-3 py-[5px] text-menu-item transition-colors ${
                item.disabled
                  ? "cursor-not-allowed bg-surface-2 text-fg-muted opacity-55"
                  : active
                    ? "bg-surface-2 font-semibold text-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`;
              return (
                <li key={item.slug}>
                  {item.disabled ? (
                    <button type="button" disabled className={itemClass}>
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="chip bg-surface-2 text-[10px] text-fg-muted">{item.badge}</span>
                      ) : null}
                    </button>
                  ) : (
                    <Link href={item.href} aria-current={active ? "page" : undefined} className={itemClass}>
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="chip bg-surface-2 text-[10px] text-fg-muted">{item.badge}</span>
                      ) : null}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The two-column body a menu-bearing surface renders inside the shell:
 * SectionMenu at inline-start, the page's content column filling the rest.
 * (The rail and top bar come from PlatformShell around this.)
 *
 * The menu column is RESIZABLE from md up (user directive, 2026-08-18):
 * 15% of the row by default and at minimum, 30% at most — the middle column
 * takes everything the sides give up. Below md the stacked mobile layout is
 * untouched.
 */
export function MenuLayout({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  const t = useTranslations("nav");
  return (
    /* min-h-full so a content child may center itself vertically (the hub);
       pages taller than the viewport are unaffected */
    <div className="flex min-h-full w-full flex-col md:flex-row">
      <ResizablePanel side="start" spec={MENU_PANEL} label={t("resizeMenu")} className="w-full">
        {menu}
      </ResizablePanel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
