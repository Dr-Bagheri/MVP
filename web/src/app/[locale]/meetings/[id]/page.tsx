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
          monitor between a meeting's details and who is coming to it.

          `fill` (observed 2026-09-08: the transcript grew without bound
          instead of scrolling in its panel). The transcript's own box has
          asked to be a scroller since it was written — `min-h-0 flex-1
          overflow-y-auto`, which is SectionScroller's shape — and that only
          means anything when something above it is BOUNDED. Without `fill`
          the column grows with its content, so `flex-1` resolved to "as tall
          as 392 segments" and the page scrolled instead of the panel. This
          is the one line that bounds it, and it is the record screen's own
          arrangement rather than a height picked here: see PageContainer for
          why a page has to opt into that height model out loud. */}
      <PageContainer width="small" fill>
        <MeetingPage id={id} />
      </PageContainer>
    </PlatformShell>
  );
}
