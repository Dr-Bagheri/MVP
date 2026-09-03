"use client";

import { useTranslations } from "next-intl";
import { PageContainer } from "@/components/scaffold";
import { IconHistory, IconPlus } from "@/components/icons";
import { useRouter, Link } from "@/i18n/routing";
import { useAssistantConversation } from "./AssistantConversationState";

/**
 * The assistant domain's TOOLBAR — two destinations, on top, the shape every
 * other surface wears (user directive, 2026-09-02).
 *
 * New conversation is present across the entire Assistant domain. On Home it
 * resets an already-started thread (and is a harmless no-op when blank); from
 * every other Assistant page it is an ordinary link back to that blank Home.
 */
export function AssistantMenu({
  activeSlug,
  width = "small",
}: {
  activeSlug: "new" | "hub" | "history" | "workflows" | "integrations" | "agents";
  /** the column the toolbar sits in — the SAME column as the content under
      it (audit finding, 2026-09-02: the hub is the small column and this
      toolbar was the default one, so the buttons began ~100px outside the
      column the composer began in — the split TwoPane had already removed
      for Management and Settings) */
  width?: "small" | "normal";
}) {
  const router = useRouter();
  const t = useTranslations("platform");
  const tConversations = useTranslations("conversations");
  const { started, startNewConversation } = useAssistantConversation();
  const isHub = activeSlug === "new" || activeSlug === "hub";


  /* through the SAME resolver the hub's chips use (user report: the English
     menu suggested «کارهای این تماس را فهرست کن»). A system skill's starters
     are shipped product copy and localize; an org-authored skill's are its
     author's words and come off the wire untouched — `lib/skillName.ts`
     owns that line, and reading the wire directly here was this menu
     quietly opting out of it. */

  /* numbered over the FULL list so the menu and the history table agree
     about which conversation is «گفت‌وگوی جدید ۲» */
  return (
    /*
     * THE ASSISTANT'S TOOLBAR — two destinations, on top (user directive,
     * 2026-09-02: "remove the sub menu from its side and put it on top … no
     * more recents").
     *
     * The recents went with the pane, and not merely to shorten a list: two
     * conversations in a menu is a sample, and a sample raises the question
     * "where are the rest" on a surface that could not answer it. History is
     * a page, with a table, and the button that opens it sits beside the one
     * that starts a new conversation — which is the pairing a person is
     * actually choosing between.
     *
     * The suggestions went too: they belong ABOVE the composer, after the
     * assistant's first line, where they read as things to say rather than
     * as a menu of features.
     */
    <PageContainer width={width} className="!pb-0">
      <nav aria-label={t("assistantMenuLabel")} className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          /* on the HUB it resets an already-started thread and is a no-op on a
             blank one — bumping the reset on an empty composer would remount
             the screen for no reason and lose whatever was half-typed. From a
             subpage it simply goes there. */
          onClick={() => {
            if (!isHub) { router.push("/assistant"); return; }
            if (started) startNewConversation();
          }}
          className={`btn btn-sm gap-1.5 font-medium ${
            isHub && !started
              ? "bg-accent text-on-accent"
              : "text-fg-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          <IconPlus width={12} height={12} />
          {t("newConversation")}
        </button>
        {/*
          THE HISTORY BUTTON IS NOT DRAWN ON THE HISTORY PAGE (user directive,
          2026-09-02: "remove the search under the new conversation and also
          the history button itself").

          It was the ACTIVE item of a two-item toolbar, which means it was a
          control whose only job was to navigate to the page you were already
          standing on — and it read as a filter you might turn off. Elsewhere
          it is the door to this page and stays.
        */}
        {activeSlug === "history" ? null : (
          <Link
            href="/conversations"
            className="btn btn-sm gap-1.5 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <IconHistory width={12} height={12} />
            {tConversations("title")}
          </Link>
        )}
      </nav>
    </PageContainer>
  );
}
