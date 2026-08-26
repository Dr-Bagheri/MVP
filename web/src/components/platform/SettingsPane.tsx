"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TwoPane, type PaneGroup } from "./TwoPane";

/**
 * SETTINGS' two-pane menu, extracted from the settings page (2026-08-26)
 * so that four pages living at /management/* can wear it.
 *
 * The directive was "put assistant and services into the settings sub
 * menu". Their SURFACES stay where they are — the pages, their URLs, their
 * redirects, their rail entry and their breadcrumbs are all untouched — and
 * what moved is the menu those pages render. One nav model in one file,
 * because a menu declared per page is a menu that disagrees with itself,
 * and the drift shows as a section reachable from three of its four
 * siblings.
 *
 * The two new groups link ACROSS to /management/*, and that is deliberate
 * rather than sloppy: one home per feature, more than one door to it. The
 * alternative — copying those surfaces under /settings — is two homes for
 * one feature, which is two states to disagree.
 */

export type SettingsGroup = "configuration" | "assistant" | "service" | "connections" | "compliance";

export interface SettingsSection {
  slug: string;
  group: SettingsGroup;
  /** an absolute href when the surface lives outside /settings */
  href?: string;
  /** the label comes from another namespace when the page is not ours */
  labelFrom?: "management";
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { slug: "general", group: "configuration" },
  { slug: "assistant", group: "configuration" },
  { slug: "security", group: "configuration" },
  { slug: "sso", group: "configuration" },
  /* the assistant's own configuration — the pages keep their addresses */
  { slug: "skills", group: "assistant", href: "/management/skills", labelFrom: "management" },
  { slug: "models", group: "assistant", href: "/management/models", labelFrom: "management" },
  { slug: "connectors", group: "service", href: "/management/connectors", labelFrom: "management" },
  { slug: "server", group: "service", href: "/management/server", labelFrom: "management" },
  { slug: "oauth-apps", group: "connections", href: "/connectors" },
  { slug: "audit-logs", group: "compliance" },
  { slug: "audit-log-drains", group: "compliance" },
  { slug: "legal", group: "compliance" },
];

const GROUP_ORDER: readonly SettingsGroup[] = [
  "configuration", "assistant", "service", "connections", "compliance",
];

export function useSettingsGroups(): PaneGroup[] {
  const t = useTranslations("settings");
  const tManagement = useTranslations("management");
  return GROUP_ORDER.map((group) => ({
    key: group,
    /* the two borrowed groups borrow their TITLES too — one word for one
       thing, wherever it is read */
    title: group === "assistant" || group === "service"
      ? tManagement(`group.${group === "assistant" ? "ai" : "service"}`)
      : t(`group.${group}`),
    items: SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => ({
      slug: section.slug,
      href: section.href ?? `/settings/${section.slug}`,
      label: section.labelFrom === "management"
        ? tManagement(`section.${section.slug}`)
        : t(`section.${section.slug}`),
    })),
  })).filter((group) => group.items.length > 0);
}

/** the pane itself, for the pages that are not the settings route */
export function SettingsPane({
  activeSlug,
  width = "default",
  children,
}: {
  activeSlug: string;
  width?: "default" | "wide";
  children: ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={useSettingsGroups()}
      activeSlug={activeSlug}
      width={width}
    >
      {children}
    </TwoPane>
  );
}
