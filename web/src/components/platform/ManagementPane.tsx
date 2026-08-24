"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TwoPane, type PaneGroup } from "./TwoPane";
import { IconChip, IconPlug, IconPulse, IconSparkle, IconUsers } from "@/components/icons";

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

/** Section slugs, in menu order within their group. */
const GROUPS: readonly { key: string; slugs: readonly string[] }[] = [
  { key: "people", slugs: ["users"] },
  { key: "ai", slugs: ["skills", "models"] },
  { key: "service", slugs: ["connectors", "server"] },
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

  /* menu icons (2026-08-24, sana reference) */
  const ICONS: Record<string, ReactNode> = {
    users: <IconUsers />,
    skills: <IconSparkle />,
    models: <IconChip />,
    connectors: <IconPlug />,
    server: <IconPulse />,
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

  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={groups}
      activeSlug={activeSlug}
    >
      {children}
    </TwoPane>
  );
}
