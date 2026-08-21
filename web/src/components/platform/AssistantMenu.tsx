"use client";

import { useTranslations } from "next-intl";
import { SectionMenu } from "@/components/scaffold";
import { useAssistantConversation } from "./AssistantConversationState";

/**
 * The assistant domain's section menu (user directive, 2026-08-18: "add the
 * sub menu for left like the other pages") — History and Search joined the
 * rail as first-class destinations, and a destination page without the
 * platform's two-pane anatomy read as a different product.
 *
 * Same skeleton as Echo's menu: a heading, grouped entries, active pill.
 * New conversation is present across the entire Assistant domain. On Home it
 * resets an already-started thread (and is a harmless no-op when blank); from
 * every other Assistant page it is an ordinary link back to that blank Home.
 */
export function AssistantMenu({
  activeSlug,
}: {
  activeSlug: "new" | "hub" | "history" | "search" | "workflows" | "agents";
}) {
  const t = useTranslations("platform");
  const { started, startNewConversation } = useAssistantConversation();
  const isHub = activeSlug === "new" || activeSlug === "hub";
  return (
    <SectionMenu
      navLabel={t("assistantMenuLabel")}
      heading={t("assistantMenuHeading")}
      groups={[
        {
          key: "conversation",
          title: t("assistantMenuConversation"),
          items: [
            {
              slug: "new",
              href: "/",
              label: t("newConversation"),
              /* On Home this stays put; on every subpage it returns to Home. */
              preventNavigation: isHub,
              onSelect: isHub && started ? startNewConversation : undefined,
            },
            { slug: "history", href: "/conversations", label: t("history") },
          ],
        },
        {
          key: "explore",
          title: t("assistantMenuExplore"),
          items: [{ slug: "search", href: "/search", label: t("search") }],
        },
        {
          /* the assistant's setup doors (user directive, round 2: they left
             the rail for this menu) — links into Management's own surfaces,
             not copies of them */
          key: "setup",
          title: t("assistantMenuSetup"),
          items: [
            { slug: "workflows", href: "/workflows", label: t("workflows") },
            { slug: "agents", href: "/agents", label: t("agents") },
          ],
        },
      ]}
      activeSlug={activeSlug}
    />
  );
}
