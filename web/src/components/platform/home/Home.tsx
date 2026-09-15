"use client";

import { useSearchParams } from "next/navigation";
import { AssistantConversationProvider } from "@/components/platform/AssistantConversationState";
import { Agents } from "@/components/platform/Agents";
import { Hub } from "@/components/platform/Hub";
import { Workflows } from "@/components/platform/Workflows";
import { PageContainer } from "@/components/scaffold";
import { HomeConversationsSheet, HomeSidebar } from "./HomeSidebar";
import { FirstRunDoor } from "@/components/onboarding/FirstRunDoor";
import { HomeSnapshot } from "./HomeSnapshot";

/**
 * HOME — the platform's first page, and it is the AGENT.
 *
 * Two columns, and the split is the directive's other half. The rail beside
 * them is a 72px column of icons now, which is what freed the room for this
 * one: the sidebar holds the three app buttons and the conversation sessions,
 * where the 248px menu it replaced held nine links that never change.
 *
 * **THE VIEW PANE**.
 * `?view=workflows` and `?view=agents` swap what the right column renders and
 * leave the sidebar exactly where it was — the reference's whole point, and
 * the reason these are not links to `/workflows` and `/agents`: navigating
 * there takes the conversations off screen to show a list of six workflows.
 *
 * A URL rather than component state, for the reasons a URL is always the
 * better of the two here: the pane survives a reload, it can be sent to a
 * colleague, the sidebar and the pane read ONE value instead of passing a
 * second copy between them, and `/workflows` and `/agents` can redirect into
 * it — so each surface still has exactly one home.
 *
 * An unknown `?view=` falls through to the conversation rather than rendering
 * an error: this param is chrome, and a mistyped one should cost the reader
 * nothing more than the screen they were going to get anyway.
 *
 * **The conversation is the page, not a widget on it.** `Hub` is the same
 * component `/assistant` rendered and the same store behind it, so a run
 * started here survives walking to the meetings page — or into this page's own
 * view pane — and back. Unmounting it drops a subscription; it does not abort
 * a run (lib/assistantSession owns the thread).
 *
 * NO ASSISTANT SIDEBAR ON THIS PAGE: `sidebarIsSilentOn` names `/` for the
 * reason it used to name `/assistant` — the page IS this conversation at full
 * width, and a strip beside it offering to open a second copy is a door into
 * the room you are standing in.
 */
export function Home() {
  const view = useSearchParams().get("view");

  return (
    /*
     * THE PAGE DOES NOT SCROLL; THE PANE AND THE SIDEBAR DO. The shell is
     * `h-dvh` and grants this row its height; `min-h-0` is what lets both
     * columns be SMALLER than their content so their own scrollers carry it.
     *
     * The sidebar is `lg:flex` — below that the rail plus a 256px column plus
     * a readable conversation do not fit at once. A column squeezed to 100px
     * is not a compromise, it is a third thing that works for nobody. Below
     * `lg` the same component renders inside `HomeConversationsSheet` instead:
     * the sentence used to end "and the conversations have their own page one
     * press away", which stopped being true when this sidebar became the only
     * place they are listed.
     */
    <div className="flex h-full min-h-0">
      <AssistantConversationProvider>
        {/* the first-run door (M54): «how would you like to use NeurAI
            first?», once, after the flow — it reads the identity the shell
            already cached and renders nothing for everybody else */}
        <FirstRunDoor />
        <HomeSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* BELOW lg THE COLUMN IS A SLIDE-OVER (2026-09-08). The paragraph
              above says the sidebar is `lg:flex` because three columns do not
              fit — true, and it left a phone with no door to the buttons or
              the conversations at all. The sheet is that door; it renders the
              SAME component, so there is still one conversations list. */}
          <HomeConversationsSheet />
          {view === "workflows" || view === "agents" ? (
            /* THE PANE'S OWN SCROLLER. The Hub below is a fixed box that
               scrolls its thread internally; these two are ordinary pages that
               are as tall as their content, so the scroll has to live here —
               on the column, not on the row, or the sidebar would scroll away
               with the list. */
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
              {view === "workflows" ? <Workflows /> : <Agents />}
            </div>
          ) : (
            /* the same small column the assistant page used: a conversation is
               reading width, and a thread stretched across a list column makes
               every line a journey */
            <PageContainer width="small" fill className="!pt-4 !pb-6">
              <Hub idleContent={<HomeSnapshot />} />
            </PageContainer>
          )}
        </div>
      </AssistantConversationProvider>
    </div>
  );
}
