import { Rooms } from "@/components/platform/Rooms";

/**
 * /agents is the ROOMS surface now (db/0164, user directive 2026-09-03).
 *
 * The address did not move, and that is deliberate: the rail entry, the
 * Ctrl+Shift+A shortcut, the breadcrumb table and anyone's bookmark all point
 * here, and a rename would have been an IA change wearing a URL change — the
 * lesson `/calls` taught this repo (a redirect keeps every reachability check
 * green while the trail quietly lies).
 */
export default function AgentsPage() {
  return <Rooms />;
}
