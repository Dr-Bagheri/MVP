import { PlatformShell } from "@/components/platform/PlatformShell";
import { AgentDetail } from "@/components/platform/AgentDetail";

/**
 * One agent's own page (user directive, 2026-09-04: "when clicked, inside it
 * must have all the options and details related to these two").
 *
 * Addressed by HANDLE, not id: `@roya` is what a person types to summon her
 * and what the roster shows on every card, so it is the name this URL should
 * carry. An id would be a second identifier for the same agent, visible in the
 * address bar and meaningless to the person reading it.
 */
export default async function AgentPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return (
    <PlatformShell>
      <AgentDetail handle={handle} />
    </PlatformShell>
  );
}
