import { Suspense } from "react";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { AssistantConversationProvider } from "@/components/platform/AssistantConversationState";
import { Hub } from "@/components/platform/Hub";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout } from "@/components/scaffold";

/**
 * NeurAI's first page IS the assistant hub (M22) — this route used to redirect
 * to /calls, which was correct when Echo was the product and is wrong now that
 * Echo is an app inside a platform.
 *
 * No assistant pane is rendered here, and that is the point rather than an
 * omission: on the hub the assistant is the page. See `PlatformShell` for why
 * the shell never places one.
 */
export default function HubPage() {
  return (
    <PlatformShell>
      {/*
        **The Suspense boundary is required, not decorative.**

        `Hub` reads `?c=<sessionId>` through `useSearchParams()` to resume a
        conversation. Next prerenders this route, and a component reading search
        params forces a client bailout — without a boundary ABOVE it, the
        production build fails outright while the dev server renders the page
        perfectly. It did: `next build` errored on `/[locale]` while the suite,
        the typechecker and every dev-mode screenshot stayed green.

        The fallback is `null` rather than a skeleton hub: the hub's own idle
        state is the approved first impression, and a placeholder that
        approximates it would flash a second, wrong version of the screen the
        user signed off.
      */}
      <Suspense fallback={null}>
        <AssistantConversationProvider>
          {/* New conversation belongs only to the Home hub: it clears a live
              hub but remains an enabled no-op when the hub is already blank. */}
          <MenuLayout menu={<AssistantMenu activeSlug="new" showNewConversation />}>
            <Hub />
          </MenuLayout>
        </AssistantConversationProvider>
      </Suspense>
    </PlatformShell>
  );
}
