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
 * New conversation is only a Home-hub action. It stays visually enabled:
 * selecting it on the blank hub simply leaves the blank hub in place.
 */
export function AssistantMenu({
  activeSlug,
  showNewConversation = false,
}: {
  activeSlug: "new" | "hub" | "history" | "search" | "workflows" | "prompts";
  showNewConversation?: boolean;
}) {
  const t = useTranslations("platform");
  const { started, startNewConversation } = useAssistantConversation();
  return (
    <SectionMenu
      navLabel={t("assistantMenuLabel")}
      heading={t("assistantMenuHeading")}
      groups={[
        {
          key: "conversation",
          title: t("assistantMenuConversation"),
          items: [
            ...(showNewConversation ? [{
              slug: "new",
              href: "/",
              label: t("newConversation"),
              /* It is the current hub either way; never navigate/reload it. */
              preventNavigation: true,
              onSelect: started ? startNewConversation : undefined,
            }] : []),
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
            { slug: "prompts", href: "/management/skills", label: t("prompts") },
            { slug: "integrations", href: "/management/connectors", label: t("integrations") },
          ],
        },
      ]}
      activeSlug={activeSlug}
    />
  );
}
