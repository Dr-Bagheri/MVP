"use client";

import { type ReactNode } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";

/**
 * Echo's app shell — **the seam between the platform and an app inside it.**
 *
 * `PlatformShell` draws the rail, the top bar and the mobile bottom bar, and
 * nothing inside the content slot. This component fills that slot with Echo's
 * content.
 *
 * The DOCKED AssistantPane this shell used to own is gone (user directive,
 * 2026-08-21: the side-docked assistant — end-side in en, start-side in fa —
 * leaves every page). `AssistantSidebar` is the assistant everywhere now: one
 * column at the inline-end edge, collapsed until asked for, voice-woken,
 * Ctrl+E. The pane component itself survives only as the conversation READER
 * on /conversations, which is a different job.
 */
export function EchoAppShell({
  children,
  menu,
}: {
  children: ReactNode;
  /**
   * Echo's section menu (Part 5): when present the content column adopts
   * the platform's two-pane anatomy — SectionMenu beside, page content in
   * the middle, exactly Settings' skeleton — per the user's directive that
   * Echo look like the rest of the platform. The pane padding then comes
   * from the page's own PageContainer, not from this wrapper.
   */
  menu?: ReactNode;
}) {
  /*
   * THE MENU IS ON TOP NOW (user directive, 2026-09-02: "change it like you
   * changed the management page by removing the sub menu on the side and put
   * the top menu for them"). Same shape as Management and Settings, which is
   * the point — Echo is on its way into the meeting surface, and until then
   * it should at least not be the one app in the platform with a different
   * anatomy.
   */
  return (
    <PlatformShell>
      <div className="flex h-full min-h-0">
        <div className={`min-w-0 flex-1 overflow-y-auto ${menu ? "" : "p-5"}`}>
          {menu ? (
            <>
              <PageContainer className="!pb-0">{menu}</PageContainer>
              {children}
            </>
          ) : children}
        </div>
      </div>
    </PlatformShell>
  );
}
