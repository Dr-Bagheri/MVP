import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { ProjectScreen } from "@/components/platform/ProjectsScreen";

/** 0181 — one project. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PlatformShell>
      <PageContainer width="normal">
        <ProjectScreen id={id} />
      </PageContainer>
    </PlatformShell>
  );
}
