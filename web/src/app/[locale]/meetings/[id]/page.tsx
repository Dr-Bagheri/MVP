"use client";

import { use } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { MeetingPage } from "@/components/platform/MeetingPage";

/** One meeting's page (0145): stages, the recorder, the post-meeting tabs. */
export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PlatformShell>
      <PageContainer width="default">
        <MeetingPage id={id} />
      </PageContainer>
    </PlatformShell>
  );
}
