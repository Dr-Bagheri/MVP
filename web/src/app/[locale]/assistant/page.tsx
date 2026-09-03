import { Suspense } from "react";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { AssistantConversationProvider } from "@/components/platform/AssistantConversationState";
import { Hub } from "@/components/platform/Hub";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";

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
          {/* the toolbar is on TOP now, like every other surface (user
              directive, 2026-09-02) — and it is two links, because the
              recents that used to live in that pane are a page of their own */}
          {/*
            THE PAGE DOES NOT SCROLL; THE CONVERSATION DOES (user directive,
            2026-09-02: "i still need to scroll down for the ai assistant
            page — the scroll must be for the conversation not the page").

            The Hub already asked for `h-full overflow-hidden`, and that was
            the whole problem: it and the toolbar were SIBLINGS inside the
            shell's scrolling <main>, so "full height" meant the full height
            of main — and the toolbar's own height was then added on top of
            it. The page overflowed by exactly the height of the menu, which
            is why it looked like a small scroll that would not go away.

            A flex column fixes it at the altitude the promise is made: the
            toolbar takes what it needs, the Hub takes the rest, and `min-h-0`
            is what allows the rest to be SMALLER than its content so its own
            scroller carries the thread.
          */}
          <div className="flex h-full min-h-0 flex-col">
            {/* ONE COLUMN for the toolbar and the hub (audit finding,
                2026-09-02): the menu sat in the default 1240 column while the
                hub drew its own 1040 one, so the buttons began ~100px outside
                the column the composer began in. The hub no longer draws a
                column of its own — this container is it, with the same 16px
                under the toolbar every other surface has. */}
            <AssistantMenu activeSlug="new" width="small" />
            <PageContainer width="small" fill className="!pt-4 !pb-6">
              <Hub />
            </PageContainer>
          </div>
        </AssistantConversationProvider>
      </Suspense>
    </PlatformShell>
  );
}
