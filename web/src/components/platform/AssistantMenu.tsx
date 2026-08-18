"use client";

import { useTranslations } from "next-intl";
import { SectionMenu } from "@/components/scaffold";

/**
 * The assistant domain's section menu (user directive, 2026-08-18: "add the
 * sub menu for left like the other pages") — History and Search joined the
 * rail as first-class destinations, and a destination page without the
 * platform's two-pane anatomy read as a different product.
 *
 * Same skeleton as Echo's menu: a heading, grouped entries, active pill.
 * "New conversation" points at the hub because a fresh "/" IS a fresh
 * conversation — the entry is a door, not a duplicate mechanism.
 */
export function AssistantMenu({ activeSlug }: { activeSlug: "history" | "search" }) {
  const t = useTranslations("platform");
  return (
    <SectionMenu
      navLabel={t("assistantMenuLabel")}
      heading={t("assistantMenuHeading")}
      groups={[
        {
          key: "conversation",
          title: t("assistantMenuConversation"),
          items: [
            { slug: "new", href: "/", label: t("newConversation") },
            { slug: "history", href: "/conversations", label: t("history") },
          ],
        },
        {
          key: "explore",
          title: t("assistantMenuExplore"),
          items: [{ slug: "search", href: "/search", label: t("search") }],
        },
      ]}
      activeSlug={activeSlug}
    />
  );
}
