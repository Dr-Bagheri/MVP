import { Dashboard } from "@/components/platform/Dashboard";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";

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
 * NO SECTION MENU (user directive, 2026-08-26). A dashboard is a board, and
 * a column of links beside it competes with the tiles for the same job —
 * every destination the menu offered is a tile away, and the board wants
 * the full width to look like a board rather than a page with a sidebar.
 *
 * No Suspense boundary here either: this page reads no search params, so
 * nothing forces a client bailout the way the hub's `?c=` resume does.
 */
export default function DashboardPage() {
  return (
    <PlatformShell>
      <PageContainer width="wide">
        <Dashboard />
      </PageContainer>
    </PlatformShell>
  );
}
