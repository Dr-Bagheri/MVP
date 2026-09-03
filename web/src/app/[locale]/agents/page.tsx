import { PlatformShell } from "@/components/platform/PlatformShell";
import { Agents } from "@/components/platform/Agents";

/**
 * /agents is the ROSTER (user directive, 2026-09-03): the two agents the
 * product ships, whatever this organization has made, and the door to make
 * another.
 *
 * The address has not moved through two changes of what lives here — the rail
 * entry, the Ctrl+Shift+A shortcut, the breadcrumb table and anyone's bookmark
 * all point at it, and a rename would be an IA change wearing a URL change,
 * which is the lesson `/calls` taught this repo: the routes still resolve, so
 * every reachability check stays green while the trail quietly lies.
 */
export default function AgentsPage() {
  return (
    <PlatformShell>
      <Agents />
    </PlatformShell>
  );
}
