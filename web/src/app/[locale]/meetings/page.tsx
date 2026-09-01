import { Suspense } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { Meetings } from "@/components/platform/Meetings";

/** The meetings section (0145, the reference adoption). */
export default function MeetingsPage() {
  return (
    <PlatformShell>
      <PageContainer>
        <Suspense fallback={null}>
          <Meetings />
        </Suspense>
      </PageContainer>
    </PlatformShell>
  );
}
