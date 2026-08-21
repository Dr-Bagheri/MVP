"use client";

import { type ReactNode } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout } from "@/components/scaffold";

/**
 * Echo's app shell — **the seam between the platform and an app inside it.**
 *
 * `PlatformShell` draws the rail, the top bar and the mobile bottom bar, and
 * nothing inside the content slot. This component fills that slot with Echo's
 * content.
 *
 * The DOCKED AssistantPane this shell used to own is gone (user directive,
 * 2026-08-21: the side-docked assistant — end-side in en, start-side in fa —
 * leaves every page). The PresenceDock orb is the assistant everywhere now:
 * one home, voice-woken, Ctrl+E. The pane component itself survives only as
 * the conversation READER on /conversations, which is a different job.
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
  return (
    <PlatformShell>
      <div className="flex h-full min-h-0">
        <div className={`min-w-0 flex-1 overflow-y-auto ${menu ? "" : "p-5"}`}>
          {menu ? <MenuLayout menu={menu}>{children}</MenuLayout> : children}
        </div>
      </div>
    </PlatformShell>
  );
}
