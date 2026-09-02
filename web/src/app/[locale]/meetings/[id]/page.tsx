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
      {/* the SMALL column (user directive, 2026-09-02: "make this page a
          version of smaller page, not like the regular size one"). It is a
          plan being read and edited — two columns of cards — and at the list
          width the two halves drift so far apart that the eye has to cross a
          monitor between a meeting's details and who is coming to it. */}
      <PageContainer width="small">
        <MeetingPage id={id} />
      </PageContainer>
    </PlatformShell>
  );
}
