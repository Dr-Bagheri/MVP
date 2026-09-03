"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TwoPane, type PaneGroup } from "./TwoPane";
import { GROUP_ORDER, SETTINGS_SECTIONS } from "./settingsSections";

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

/*
 * The registry itself lives in settingsSections.ts (a plain module) so the
 * NAV MODEL can read which /management/* addresses are Settings' territory
 * without importing this client component. Re-exported here because this
 * file is where readers look for it.
 */
export {
  SETTINGS_SECTIONS,
  type SettingsGroup,
  type SettingsSection,
} from "./settingsSections";

/*
 * LEFT THE MENU (user directive, 2026-08-28): Connectors — the
 * Integrations page under the assistant is that door now, and two menus
 * to one room is how a person wonders which is real — and Audit log
 * drains, whose page was an honest not-yet shell from the day it shipped.
 * Their PAGES still resolve (/management/connectors renders;
 * /settings/audit-log-drains falls back to the first section), so
 * nothing bookmarked breaks. Same rule as the 2026-08-26 removals below.
 */

/*
 * LEFT THE MENU (user directive, 2026-08-26): Connected apps, Legal
 * documents and Service health. Their PAGES still resolve — /connectors
 * redirects, /settings/legal and /management/server render — so nothing
 * bookmarked breaks and nothing had to be deleted to take a row out of a
 * menu. What the menu offers and what the router serves are different
 * questions, and only the first one was asked.
 */



export function useSettingsGroups(): PaneGroup[] {
  const t = useTranslations("settings");
  const tManagement = useTranslations("management");
  const tPlatform = useTranslations("platform");
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
        /* a surface that belongs to the platform keeps the platform's word
           for itself — the rail and this menu must not name one room twice */
        : section.labelFrom === "platform"
          ? tPlatform(section.slug)
          : t(`section.${section.slug}`),
    })),
  })).filter((group) => group.items.length > 0);
}

/** the pane itself, for the pages that are not the settings route */
export function SettingsPane({
  activeSlug,
  /* SMALL by default (audit finding, 2026-09-02): every wearer of the
     settings menu — Integrations and the four /management/* sections that
     moved under it — sits in the same 1040 column as its siblings; a caller
     that needs the wide column says so */
  width = "small",
  children,
}: {
  activeSlug: string;
  width?: "small" | "normal";
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
