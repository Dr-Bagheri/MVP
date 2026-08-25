import { Dashboard } from "@/components/platform/Dashboard";
import { DashboardMenu } from "@/components/platform/DashboardMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout, PageContainer } from "@/components/scaffold";

/**
 * NeurAI's landing page is the DASHBOARD (user directive, 2026-08-25).
 *
 * The route's history in one line: `/` redirected to `/calls` while Echo
 * was the product, became the assistant hub when Echo became an app inside
 * a platform, and is now the platform's own first answer — what happened
 * while you were away. The hub kept its approved anatomy and moved to
 * `/assistant`; the two are separate pages precisely because one is a
 * conversation and the other is a briefing.
 *
 * No Suspense boundary here: this page reads no search params, so nothing
 * forces a client bailout the way the hub's `?c=` resume does.
 */
export default function DashboardPage() {
  return (
    <PlatformShell>
      {/* the dashboard's OWN menu (2026-08-25): the assistant's destinations
          belong to the assistant's page, not to the briefing */}
      <MenuLayout menu={<DashboardMenu />}>
        <PageContainer width="wide">
          <Dashboard />
        </PageContainer>
      </MenuLayout>
    </PlatformShell>
  );
}
