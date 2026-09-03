import { PlatformShell } from "@/components/platform/PlatformShell";
import { Integrations } from "@/components/platform/Integrations";

/**
 * A RAIL DESTINATION, so the ROUTE carries the shell (2026-09-03) — the same
 * shape meetings and tasks use. Integrations wore the Settings pane until the
 * user moved it back to the rail beside Agents; the pane brought a sub-menu
 * of eight Settings sections with it, and taking the pane away took the rail
 * and the top bar too, because TwoPane is what mounts PlatformShell.
 */
export default function IntegrationsPage() {
  return (
    <PlatformShell>
      <Integrations />
    </PlatformShell>
  );
}
