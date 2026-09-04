import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { ProjectsScreen } from "@/components/platform/ProjectsScreen";

/** 0181 — the projects list (user directive, 2026-09-04). */
export default function ProjectsPage() {
  return (
    <PlatformShell>
      <PageContainer width="normal">
        <ProjectsScreen />
      </PageContainer>
    </PlatformShell>
  );
}
