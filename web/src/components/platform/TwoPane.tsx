"use client";

import type { ReactNode } from "react";
import { Fragment } from "react";
import { PageContainer } from "@/components/scaffold";
import type { MenuGroup, MenuItem } from "@/components/scaffold";
import { Link, usePathname } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";

/**
 * THE PLATFORM'S ONE PAGE SHELL — a row of segmented buttons at the top, the
 * page under it. The name is now historical: there is no second pane.
 *
 * It was a menu BESIDE the content, and the user asked for the meetings
 * page's shape everywhere (2026-09-02: "change all the submenus in any page
 * to the same way that we did for meeting page, so it should become a top
 * menu buttons that goes to their page like the meetings page"). Thirteen
 * pages render through this one component, so the shape changes here and
 * they all follow — which is the whole reason the pane was extracted in the
 * first place.
 *
 * The group TITLES go with the pane. A vertical menu needed them to break a
 * long list into answers to different questions; a horizontal row of eight
 * buttons does not, and a heading floating above a toolbar reads as a label
 * for the page rather than for its group. The groups survive as the
 * separators between runs of buttons — the same device the meetings toolbar
 * uses between its view switch and its filters.
 *
 * The page HEADING goes too. The reference has no large page title: a page
 * says its name in the top bar and spends its height on the work.
 *
 * Settings shipped this layout first and the user asked for Management to
 * adopt it (review round 2). Since M26 it is a thin composition over the
 * scaffold — SectionMenu + PageContainer carry the approved anatomy, and
 * this file only wires them into the shell. The grouped-menu rules (labels
 * recede, no letter-spacing on Persian) live in SectionMenu now.
 *
 * **No back affordance inside a pane.** With the menu permanently beside the
 * content, a section is not a place you descend into — every sibling is one
 * click away and where you are is visible. The breadcrumb in the top bar still
 * carries the way OUT of the surface; a second control here would be the two
 * mechanisms the breadcrumb ruling exists to prevent.
 */

export type PaneItem = MenuItem;
export type PaneGroup = MenuGroup;

export function TwoPane({
  navLabel,
  groups,
  activeSlug,
  width = "default",
  children,
}: {
  navLabel: string;
  /** kept in the signature and unused: every caller passes the surface's own
      name, which the top bar already says. Removing the prop would be a
      thirteen-file change for nothing. */
  heading?: string;
  groups: readonly PaneGroup[];
  activeSlug: string;
  /** Data-dense sections (tables) may ask for the wide content column. */
  width?: "default" | "wide" | "full";
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <PlatformShell>
      {/*
        THE TOOLBAR KEEPS THE PAGE'S NORMAL COLUMN, whatever width the
        SECTION asks for (user directive, 2026-09-02: "the top menu got out of
        position"). Audit Logs asks for the wide column because it is a dense
        table — and with the nav inside that container, the same menu sat at
        1240 on seven sections and 1600 on the eighth. It moved under the
        pointer when you switched section, which is the one thing chrome may
        never do: a control that changes place between siblings has to be
        re-found every time.
        So the nav is its own container at the default width and only the
        CONTENT widens. The capability stays; the menu stops travelling.
      */}
      <PageContainer>
        <nav aria-label={navLabel} className="flex flex-wrap items-center gap-1">
            {groups.map((group, index) => (
              <Fragment key={group.key}>
                {index > 0 ? <span className="mx-1 h-5 w-px bg-border" aria-hidden /> : null}
                {group.items.map((item) => {
                  /* active by SLUG when the caller knows it, and by path
                     otherwise — a cross-homed surface (Integrations lives at
                     /integrations and wears Settings' menu) has no slug in
                     this menu's own vocabulary, and matching only on slug
                     would leave the row a person is standing on unlit. */
                  const active = item.slug === activeSlug || pathname === item.href;
                  return (
                    <Link
                      key={item.slug}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`btn btn-sm gap-1.5 font-medium ${
                        active
                          ? "bg-accent text-on-accent"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </Fragment>
            ))}
        </nav>
      </PageContainer>
      <PageContainer width={width} className="!pt-0">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </PageContainer>
    </PlatformShell>
  );
}
