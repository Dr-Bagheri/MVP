"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AssistantSession, Skill } from "@/api/types";
import { api } from "@/api/client";
import { SectionMenu } from "@/components/scaffold";
import { IconAgent, IconAsk, IconHistory, IconPlug, IconPlus, IconZap } from "@/components/icons";
import { fillComposer } from "@/lib/assistantBus";
import { useRouter } from "@/i18n/routing";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { digits } from "@/lib/format";
import { untitledNumbers } from "@/lib/sessionTitles";
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
  activeSlug: "new" | "hub" | "history" | "workflows" | "integrations" | "agents";
}) {
  const router = useRouter();
  const t = useTranslations("platform");
  const tConversations = useTranslations("conversations");
  const tWorkflows = useTranslations("workflows");
  const locale = useLocale();
  const { started, startNewConversation } = useAssistantConversation();
  const isHub = activeSlug === "new" || activeSlug === "hub";

  /* the TWO latest conversations, right in the menu (user directive,
     2026-08-22) — refreshed whenever any session changes anywhere, orb
     talks included. Clicking one opens it in the dock where you stand. */
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const sessionsEpoch = useRefreshEpoch("sessions");
  useEffect(() => {
    void api.agentSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [sessionsEpoch]);
  const recent = sessions.slice(0, 2);

  /* SUGGESTIONS (user directive, 2026-08-26): they left the hub's middle
     for this menu. One row per skill that ships starter questions — the
     product's own skills, never an invented catalogue. Pressing one fills
     the composer and selects that skill; SENDING stays the person's act,
     which is the rule these rows have carried since they existed. */
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    void api.skills().then(setSkills).catch(() => setSkills([]));
  }, []);

  /* the CREATE row below is admin-only, so the menu has to know who is
     reading it — a member seeing a door they cannot open is worse than not
     seeing it, because the refusal arrives after the click */
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    /* me() answers null when nobody is signed in — that is a state, not a
       failure, and it must not read as an admin */
    void api.me().then((who) => setRole(who?.role ?? null)).catch(() => setRole(null));
  }, []);
  const canAuthor = role === "admin" || role === "owner";
  const suggestions = skills
    .filter((skill) => skill.starter_questions.length > 0)
    .slice(0, 6);
  /* numbered over the FULL list so the menu and the history table agree
     about which conversation is «گفت‌وگوی جدید ۲» */
  const numbers = untitledNumbers(sessions);
  return (
    <SectionMenu
      navLabel={t("assistantMenuLabel")}
      heading={t("assistantMenuHeading")}
      groups={[
        /* the OVERVIEW row retired (user directive, 2026-08-26): the
           dashboard is the landing page and has its own rail icon, so a
           link to it inside the assistant's menu was a third door to a
           place already reachable from everywhere */
        {
          /* the ASSISTANCE section (user directive, 2026-08-25) — the
             conversation lives under its own name, at /assistant */
          key: "assistance",
          title: t("assistantMenuAssistance"),
          items: [
            {
              slug: "new",
              href: "/assistant",
              label: t("newConversation"),
              icon: <IconPlus />,
              /* On the hub this stays put; elsewhere it goes to a blank one. */
              preventNavigation: isHub,
              onSelect: isHub && started ? startNewConversation : undefined,
            },
            { slug: "history", href: "/conversations", label: t("history"), icon: <IconHistory /> },
            ...recent.map((session) => ({
              slug: `recent-${session.id}`,
              href: "/conversations",
              label: session.title
                ?? tConversations("newChat", { n: digits(numbers.get(session.id) ?? 1, locale) }),
              /* smaller + shifted inward (user directive, 2026-08-24) —
                 the indent says "under History"; the old «· » prefix retired */
              sub: true,
              preventNavigation: true,
              /* the assistant PAGE with the conversation resumed: the orb is
                 suppressed on every surface this menu renders on, so an
                 openAssistant() here would be a menu item that does nothing */
              onSelect: () => router.push({
                pathname: "/assistant", query: { c: session.id },
              }),
            })),
          ],
        },
        ...(suggestions.length > 0
          ? [{
              key: "suggestions",
              title: t("suggestions"),
              items: suggestions.map((skill) => ({
                slug: `suggest-${skill.slug}`,
                /* the href is real: pressed from another page this has to
                   ARRIVE at the assistant, and the draft waits for it in
                   the composer mailbox */
                href: "/assistant",
                label: skill.starter_questions[0] ?? "",
                icon: <IconAsk />,
                onSelect: () => fillComposer({
                  text: skill.starter_questions[0] ?? "",
                  skillSlug: skill.slug,
                }),
              })),
            }]
          : []),
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
            /* CREATE, directly under Workflows (user directive, 2026-08-28:
               "add create workflow in workflow section as well"). It is a
               real href, not a bus message: pressed from Integrations or a
               conversation it has to ARRIVE at the catalogue, and the page
               opens the builder from the query it lands with. */
            ...(canAuthor
              ? [{
                  slug: "workflow-new",
                  href: "/workflows",
                  label: tWorkflows("createWorkflow"),
                  icon: <IconPlus />,
                  sub: true,
                  preventNavigation: true,
                  onSelect: () => router.push({
                    pathname: "/workflows", query: { new: "1" },
                  }),
                }]
              : []),
            /* directly under Workflows (user directive, 2026-08-28) — the
               accounts a workflow runs on, so the two sit together */
            { slug: "integrations", href: "/integrations", label: t("integrations"), icon: <IconPlug /> },
            { slug: "agents", href: "/agents", label: t("agents"), icon: <IconAgent /> },
          ],
        },
      ]}
      activeSlug={activeSlug}
    />
  );
}
