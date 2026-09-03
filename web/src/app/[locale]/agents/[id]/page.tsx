"use client";

import { use } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { RoomThread } from "@/components/platform/RoomThread";

/**
 * One room (db/0164): the thread, the status line, the composer.
 *
 * `fill` because a thread must not push the composer off the bottom of the
 * document — the page owns the height the shell grants and the thread scrolls
 * inside it, which is the record screen's model and the reason that flag is
 * opt-in.
 */
export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PlatformShell>
      <PageContainer fill>
        <RoomThread id={id} />
      </PageContainer>
    </PlatformShell>
  );
}
