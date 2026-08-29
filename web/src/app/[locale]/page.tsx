import { Dashboard } from "@/components/platform/Dashboard";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";

/**
 * NeurAI's landing page is the DASHBOARD again (user directive, 2026-08-29:
 * "now bring back the dashboard as well").
 *
 * It comes back as the same BOARD — the grid, the four tile sizes, the drag,
 * the add menu — carrying a different catalogue: the platform's own surfaces
 * in miniature (people, records, a record button, integrations, four agents,
 * workflows, the connected calendar). And without the colours: the three
 * gradient families went with the same directive, so a card's identity is
 * its icon and its title.
 *
 * The route's history in one line: `/` redirected to `/calls` while Echo was
 * the product, became the assistant hub when Echo became an app inside a
 * platform, became the dashboard on 2026-08-25, was the assistant's door
 * again while the board was parked, and is the board once more.
 *
 * NO SECTION MENU (user directive, 2026-08-26). A dashboard is a board, and
 * a column of links beside it competes with the tiles for the same job —
 * every destination the menu offered is a tile away, and the board wants the
 * full width to look like a board rather than a page with a sidebar.
 *
 * No Suspense boundary here either: this page reads no search params, so
 * nothing forces a client bailout the way the assistant's `?c=` resume does.
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
