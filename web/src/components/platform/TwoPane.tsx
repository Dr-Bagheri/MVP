"use client";

import type { ReactNode } from "react";
import { MenuLayout, PageContainer, SectionMenu } from "@/components/scaffold";
import type { MenuGroup, MenuItem } from "@/components/scaffold";
import { PlatformShell } from "./PlatformShell";

/**
 * The two-pane surface: a grouped menu beside, the page in the middle.
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
  heading,
  groups,
  activeSlug,
  width = "default",
  children,
}: {
  navLabel: string;
  heading: string;
  groups: readonly PaneGroup[];
  activeSlug: string;
  /** Data-dense sections (tables) may ask for the wide content column. */
  width?: "default" | "wide" | "full";
  children: ReactNode;
}) {
  return (
    <PlatformShell>
      <MenuLayout
        menu={
          <SectionMenu navLabel={navLabel} heading={heading} groups={groups} activeSlug={activeSlug} />
        }
      >
        <PageContainer width={width}>{children}</PageContainer>
      </MenuLayout>
    </PlatformShell>
  );
}
