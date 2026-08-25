"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { AssistantSession } from "@/api/types";
import { api } from "@/api/client";
import { SectionMenu } from "@/components/scaffold";
import { IconAgent, IconGauge, IconHistory, IconPlus, IconZap } from "@/components/icons";
import { openAssistant } from "@/lib/assistantBus";
import { getHubView, getServerHubView, setHubView, subscribeHubView } from "@/lib/hubView";
import { useRefreshEpoch } from "@/lib/refreshBus";
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
  activeSlug: "new" | "hub" | "history" | "workflows" | "agents";
}) {
  const t = useTranslations("platform");
  const tConversations = useTranslations("conversations");
  const { started, startNewConversation } = useAssistantConversation();
  const isHub = activeSlug === "new" || activeSlug === "hub";
  /* the DASHBOARD is a view of the hub, not a route — the menu highlights
     it from the shared store so switching never remounts the composer */
  const hubView = useSyncExternalStore(subscribeHubView, getHubView, getServerHubView);
  const shownSlug = isHub && hubView === "dashboard" ? "dashboard" : activeSlug;

  /* the TWO latest conversations, right in the menu (user directive,
     2026-08-22) — refreshed whenever any session changes anywhere, orb
     talks included. Clicking one opens it in the dock where you stand. */
  const [recent, setRecent] = useState<AssistantSession[]>([]);
  const sessionsEpoch = useRefreshEpoch("sessions");
  useEffect(() => {
    void api.agentSessions()
      .then((rows) => setRecent(rows.slice(0, 2)))
      .catch(() => setRecent([]));
  }, [sessionsEpoch]);
  return (
    <SectionMenu
      navLabel={t("assistantMenuLabel")}
      heading={t("assistantMenuHeading")}
      groups={[
        {
          /* the OVERVIEW (user directive, 2026-08-25): the hybrid dashboard
             joins the home menu — a view of the hub, composer kept */
          key: "overview",
          title: t("assistantMenuOverview"),
          items: [
            {
              slug: "dashboard",
              href: "/?view=dashboard",
              label: t("dashboard"),
              icon: <IconGauge />,
              preventNavigation: isHub,
              onSelect: isHub ? () => setHubView("dashboard") : undefined,
            },
          ],
        },
        {
          /* the ASSISTANCE section (user directive, 2026-08-25) — the
             conversation lives under its own name */
          key: "assistance",
          title: t("assistantMenuAssistance"),
          items: [
            {
              slug: "new",
              href: "/",
              label: t("newConversation"),
              icon: <IconPlus />,
              /* On Home this stays put; on every subpage it returns to Home. */
              preventNavigation: isHub,
              onSelect: isHub
                ? () => {
                    setHubView("chat");
                    if (started) startNewConversation();
                  }
                : undefined,
            },
            { slug: "history", href: "/conversations", label: t("history"), icon: <IconHistory /> },
            ...recent.map((session) => ({
              slug: `recent-${session.id}`,
              href: "/conversations",
              label: session.title ?? tConversations("untitled"),
              /* smaller + shifted inward (user directive, 2026-08-24) —
                 the indent says "under History"; the old «· » prefix retired */
              sub: true,
              preventNavigation: true,
              onSelect: () => openAssistant({ sessionId: session.id }),
            })),
          ],
        },
        /* Search LEFT this menu for Echo's (user directive, 2026-08-25) —
           it searches the records, so it lives with them */
        {
          /* the assistant's setup doors (user directive, round 2: they left
             the rail for this menu) — links into Management's own surfaces,
             not copies of them */
          key: "setup",
          title: t("assistantMenuSetup"),
          items: [
            { slug: "workflows", href: "/workflows", label: t("workflows"), icon: <IconZap /> },
            { slug: "agents", href: "/agents", label: t("agents"), icon: <IconAgent /> },
          ],
        },
      ]}
      activeSlug={shownSlug}
    />
  );
}
