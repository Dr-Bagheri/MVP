import { Suspense } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { ProjectsScreen } from "@/components/platform/ProjectsScreen";

/** 0181 — the projects list (user directive, 2026-09-04). */
export default function ProjectsPage() {
  return (
    <PlatformShell>
      <PageContainer width="normal">
        {/* Suspense because the list reads `?project=` for the panel's deep
            link — `useSearchParams` forces a client bailout, and without the
            boundary the production build refuses the page while dev renders
            it perfectly (the build gate's reason to exist). */}
        <Suspense fallback={null}>
          <ProjectsScreen />
        </Suspense>
      </PageContainer>
    </PlatformShell>
  );
}
