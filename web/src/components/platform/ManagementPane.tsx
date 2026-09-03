"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TwoPane, type PaneGroup } from "./TwoPane";
import { IconGauge, IconGavel, IconMailPlus, IconUser } from "@/components/icons";

/**
 * Management's two-pane surface (user directive, review round 2: "Management
 * adopts the Settings layout").
 *
 * The nav model lives HERE, in one place, rather than in each section's page —
 * five pages each declaring the menu is five chances for the menu to disagree
 * with itself, and the drift shows up as a section that exists but is
 * unreachable from four of its siblings.
 *
 * **Groups, and why these ones.** The sections answer three different
 * questions — who is in the org, what the assistant may do, and what the
 * service is doing — and the grouped menu is only worth having if the groups
 * are real. `models` sits with `skills` because both configure the agent, not
 * because both are technical.
 *
 * `/management` itself keeps a landing rather than redirecting into a section:
 * Users is admin-gated, so a redirect would drop every member onto a refusal
 * card as the first thing Management ever shows them.
 */

/**
 * Section slugs, in menu order within their group.
 *
 * ASSISTANT and SERVICE moved under SETTINGS (user directive, 2026-08-26:
 * "put assistant and services into the settings sub menu as well"). Their
 * PAGES did not move: /management/skills and its three siblings keep their
 * addresses, so every bookmark, redirect, rail entry and breadcrumb that
 * points at them still lands. What changed is the menu they wear — those
 * four pages render the Settings pane now, and this menu keeps the one
 * question that is genuinely Management's: who is in the organisation.
 *
 * Moving the routes instead would have been the tidier diagram and the
 * worse change: four redirects, a rail entry, two trail registrations and
 * a reachability check, all to rename a URL nobody complained about.
 */
const GROUPS: readonly { key: string; slugs: readonly string[] }[] = [
  { key: "org", slugs: ["general"] },
  { key: "people", slugs: ["users", "invitations", "privileges"] },
];

/**
 * Sections whose surface is named but not yet wired — EMPTY since Part 3
 * wired the last one (models). The mechanism stays: a future section that
 * isn't built must say so before anyone spends a click on it.
 */
const NOT_WIRED: readonly string[] = [];

export function ManagementPane({
  activeSlug,
  children,
}: {
  /** `""` on the Management landing itself — no item is current there. */
  activeSlug: string;
  children: ReactNode;
}) {
  const t = useTranslations("management");
  /* the label is ECHO's word for it — one vocabulary for one thing,
     wherever it is read */
  const tEcho = useTranslations("echo");

  /* menu icons (2026-08-24, sana reference) */
  const ICONS: Record<string, ReactNode> = {
    general: <IconGauge />,
    users: <IconUser />,
    /* privileges: a shield-shaped door. It is admin-only, and the icon
       says "protection", not "settings" — the difference is the point */
    privileges: <IconGavel />,
    /* its own icon (user directive): an envelope-shaped door, not a
       second person glyph — inviting is not the same act as listing */
    invitations: <IconMailPlus />,
  };

  const groups: PaneGroup[] = GROUPS.map((group) => ({
    key: group.key,
    title: t(`group.${group.key}`),
    items: group.slugs.map((slug) => ({
      slug,
      href: `/management/${slug}`,
      label: t(`section.${slug}`),
      icon: ICONS[slug],
      ...(NOT_WIRED.includes(slug) ? { badge: t("notWired") } : {}),
    })),
  }));

  /*
   * SPEAKERS lives here now (user directive, 2026-09-02: "speakers from sub
   * menu change location to the managements, added to the top menu with same
   * function"). It sat inside Echo, and a voice print is a fact about a
   * COLLEAGUE rather than about a recording — which is why it belongs beside
   * the people of the organisation and not beside the takes.
   *
   * Cross-homed the way Skills and Models were: the page keeps its address,
   * so nothing bookmarked breaks and there is still one home per feature.
   */
  const withSpeakers: PaneGroup[] = groups.map((group) =>
    group.key === "people"
      ? {
          ...group,
          items: [
            ...group.items,
            /* its OWN Management address now (2026-09-02): the entry moved
               here but the page had stayed under Echo's shell, so this
               button led out of the room it sat in — Echo breadcrumb, no
               Management toolbar. /echo/speakers redirects. */
            { slug: "speakers", href: "/management/speakers", label: tEcho("section.speakers") },
          ],
        }
      : group,
  );

  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={withSpeakers}
      activeSlug={activeSlug}
    >
      {children}
    </TwoPane>
  );
}
