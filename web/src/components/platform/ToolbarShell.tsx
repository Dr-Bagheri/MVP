"use client";

import { type ReactNode } from "react";
import { PlatformShell } from "./PlatformShell";
import { PageContainer } from "@/components/scaffold";

/**
 * THE PLATFORM SHELL WITH A TOOLBAR ABOVE THE CONTENT.
 *
 * This was `components/echo/EchoAppShell.tsx` until the Echo surface was
 * removed (user directive, 2026-09-04: "remove the Echo page completely, we
 * don't need it any more"). It moved rather than went, because it was never
 * Echo's: it is `PlatformShell` plus one row of controls above the page, and
 * its only remaining caller — the record document — passes its OWN four tabs
 * (summary, transcript, actions, notes), not Echo's section menu.
 *
 * A component that outlives the feature it was named after should be renamed
 * on the way out. Leaving it called `EchoAppShell` in a product with no Echo
 * is how somebody a month from now reads a name as a claim about where the
 * thing belongs, and moves the wrong file.
 *
 * `TwoPane` is the platform's other shell and is NOT this: it owns its own
 * navigation, derived from a section registry. This one takes whatever row
 * the page hands it, which is what a document with its own tabs needs.
 */
export function ToolbarShell({
  children,
  toolbar,
}: {
  children: ReactNode;
  /**
   * The row of controls above the page. When present the content column drops
   * its own padding — the toolbar's `PageContainer` sets the gutters, and two
   * paddings on one column is the second answer that makes a screen sit
   * twelve pixels off from its siblings.
   */
  toolbar?: ReactNode;
}) {
  return (
    <PlatformShell>
      <div className="flex h-full min-h-0">
        <div className={`min-w-0 flex-1 overflow-y-auto ${toolbar ? "" : "p-5"}`}>
          {toolbar ? (
            <>
              <PageContainer className="!pb-0">{toolbar}</PageContainer>
              {children}
            </>
          ) : children}
        </div>
      </div>
    </PlatformShell>
  );
}
