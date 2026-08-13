"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { NavGroup } from "./NavGroup";
import { PlatformShell } from "./PlatformShell";

/**
 * The two-pane surface: a grouped menu beside, the page in the middle.
 *
 * Settings shipped this layout first and the user asked for Management to
 * adopt it (review round 2). It is extracted rather than copied, because two
 * surfaces that are supposed to look identical and are maintained separately
 * do not stay identical — the grouped-header fix would have had to be made
 * twice, and the second one is the one nobody makes.
 *
 * **Grouping comes from `NavGroup`, so the round-2 rules apply from birth.**
 * The user read the Settings sidebar as one flat menu because group titles and
 * items shared a colour and sat 6px apart; anything built on this component
 * inherits the corrected pattern instead of re-earning the same complaint.
 *
 * **No back affordance inside a pane.** With the menu permanently beside the
 * content, a section is not a place you descend into — every sibling is one
 * click away and where you are is visible. The breadcrumb in the top bar still
 * carries the way OUT of the surface; a second control here would be the two
 * mechanisms the breadcrumb ruling exists to prevent.
 */

export interface PaneItem {
  slug: string;
  href: string;
  label: string;
  /**
   * Short chip shown beside the label — for a section that is named but not
   * yet usable. Marked IN the menu, not after you click: finding out a section
   * is empty by opening it is the experience the marker exists to prevent.
   */
  badge?: string;
}

export interface PaneGroup {
  key: string;
  title: string;
  items: readonly PaneItem[];
}

export function TwoPane({
  navLabel,
  heading,
  groups,
  activeSlug,
  children,
}: {
  navLabel: string;
  heading: string;
  groups: readonly PaneGroup[];
  activeSlug: string;
  children: ReactNode;
}) {
  return (
    <PlatformShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-5 md:flex-row">
        <nav aria-label={navLabel} className="w-full shrink-0 md:w-56">
          <h1 className="mb-4 text-xl font-bold text-fg">{heading}</h1>
          {groups.map((group) => (
            <NavGroup key={group.key} title={group.title}>
              {group.items.map((item) => {
                const active = item.slug === activeSlug;
                return (
                  <li key={item.slug}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`tap flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-accent-soft font-semibold text-accent"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span className="chip bg-surface-2 text-[10px] text-fg-muted">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </NavGroup>
          ))}
        </nav>

        <section className="min-w-0 flex-1">{children}</section>
      </div>
    </PlatformShell>
  );
}
