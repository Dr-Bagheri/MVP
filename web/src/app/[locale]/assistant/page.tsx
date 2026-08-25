import { Suspense } from "react";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { AssistantConversationProvider } from "@/components/platform/AssistantConversationState";
import { Hub } from "@/components/platform/Hub";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout } from "@/components/scaffold";

/**
 * The ASSISTANT hub — the composer screen (M22's approved anatomy), moved
 * off `/` on 2026-08-25 when the dashboard became the landing page. The
 * approval survives the move: the same greeting, orb, composer and app
 * cards, at their own address, so the dashboard and the conversation stop
 * sharing one screen.
 *
 * No assistant pane is rendered here, and that is the point rather than an
 * omission: on this page the assistant IS the page.
 */
export default function AssistantPage() {
  return (
    <PlatformShell>
      {/*
        **The Suspense boundary is required, not decorative.**

        `Hub` reads `?c=<sessionId>` through `useSearchParams()` to resume a
        conversation. Next prerenders this route, and a component reading search
        params forces a client bailout — without a boundary ABOVE it, the
        production build fails outright while the dev server renders the page
        perfectly.

        The fallback is `null` rather than a skeleton hub: the hub's own idle
        state is the approved first impression, and a placeholder that
        approximates it would flash a second, wrong version of that screen.
      */}
      <Suspense fallback={null}>
        <AssistantConversationProvider>
          <MenuLayout menu={<AssistantMenu activeSlug="new" />}>
            <Hub />
          </MenuLayout>
        </AssistantConversationProvider>
      </Suspense>
    </PlatformShell>
  );
}
