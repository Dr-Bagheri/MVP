"use client";

import type { ReactNode } from "react";
import { sectionTabClass } from "./sectionTabs";
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
  width = "small",
  actions,
  children,
}: {
  navLabel: string;
  /** the page's one create button, at the END of row 1 (R3) */
  actions?: ReactNode;
  /** kept in the signature and unused: every caller passes the surface's own
      name, which the top bar already says. Removing the prop would be a
      thirteen-file change for nothing. */
  heading?: string;
  groups: readonly PaneGroup[];
  activeSlug: string;
  /**
   * SMALL BY DEFAULT (user directive, 2026-09-02: "redesign the management
   * pages and settings pages, with small page as a template … both for them
   * and their sub pages").
   *
   * Management and Settings are reading-and-editing surfaces — a form, a
   * list of people, a set of switches — and they were laid out at the LIST
   * width, so every field stretched the full 1240 and a label sat a screen
   * away from the control it named. `small` is the meeting-plan column,
   * which is the page the directive names as the template.
   *
   * The wide column stays available for a section that is genuinely a dense
   * table (Audit Logs asks for it), and the TOOLBAR keeps its own default
   * column regardless — see below.
   */
  width?: "small" | "normal";
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
      {/*
        ONE COLUMN FOR THE TOOLBAR AND ITS CONTENT (user directive, 2026-09-02:
        "make it look like the small page exactly, with sub menu on top close
        to it and starting at the border of the tables like in the before
        meeting page").

        The toolbar used to sit in its OWN container at the default width
        while the content sat in the section's — so on a small section the
        buttons started 100px outside the column the cards started in, and
        the two read as unrelated. That split existed for one reason: Audit
        Logs asked for the wide column, and a toolbar that widened with it
        moved between sibling sections. Every section is small now, so the
        reason is gone; the meeting page — the template — puts its stepper and
        its cards in one column with one gap, and so does this.
      */}
      <PageContainer width={width} className="!pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
                      /* the class is shared with the in-page tab strip
                         (`sectionTabs`): a menu of routes and a menu of views
                         answer the same question about the same screen, so
                         they must not look like two different controls */
                      className={sectionTabClass(active)}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </Fragment>
            ))}
        </nav>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
        </div>
      </PageContainer>
      {/* pt-4, not the page's own top padding: the toolbar and the content it
          filters are ONE block, and the meeting page (the template) puts its
          stepper and its cards in one column with `gap-4` — sixteen pixels.
          A full page gap here made the menu look like a separate screen
          floating above the table (user directive, 2026-09-02: "make the gap
          between the table and the sub menu of the top closer, like the
          meeting page, for all other pages"). */}
      {/* `!pt-3` = the board's own gap-3 under its toolbar (user, 2026-09-05:
          "an equal gap for all pages between the first sub menu and the
          page's tables, buttons or content"); it was pt-4, four pixels
          wider than the tasks and meetings pages the rest of the platform
          copies, on every TwoPane page at once */}
      <PageContainer width={width} className="!pt-3">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </PageContainer>
    </PlatformShell>
  );
}
