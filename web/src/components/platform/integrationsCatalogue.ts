"use client";

import { useTranslations } from "next-intl";
import type { ConnectorProvider } from "@/api/types";
import type { IconName } from "@/components/icons";
import { OFFERED_CONNECTOR_PROVIDERS } from "@echo/core/vocabulary";

/**
 * THE integrations catalogue — one list shared by the overview page and the
 * per-integration detail page (user directive, 2026-08-28: "add google meet,
 * google drive, gmail there as well … when you click … it must show like the
 * image").
 *
 * Extracted from Integrations.tsx the day the detail page arrived, because
 * two screens each holding their own four-entry list is exactly how one of
 * them learns about Drive and the other keeps rendering three tiles.
 *
 * `source` is the WIRE's word, verbatim: it becomes the last segment of
 * `GET /v1/connectors/:provider/:source` (mail | calendar | drive | meet —
 * core/src/api/server.ts). Keeping the union identical to the route's own
 * vocabulary means an entry cannot name a source the server would 400.
 *
 * `slug` is the URL address (`/integrations/[slug]`) — kebab-case because it
 * is read by people in an address bar, where `googleCalendar` reads as code.
 */
export type IntegrationSource = "mail" | "calendar" | "drive" | "meet";

export interface IntegrationEntry {
  /** the address: /integrations/<slug> */
  slug: string;
  /** message-key base in the `integrations` namespace (name + `${key}Desc`) */
  key: "gmail" | "googleCalendar" | "googleDrive" | "googleMeet" | "outlookMail" | "outlookCalendar";
  provider: ConnectorProvider;
  source: IntegrationSource;
  icon: IconName;
}

/**
 * Every integration the platform's code CAN speak, once each. Drive and Meet
 * exist only for Google — they are lenses on the one Google grant, not
 * providers of their own, and the server 400s them for Microsoft.
 */
export const ALL_INTEGRATIONS = [
  { slug: "gmail", key: "gmail", provider: "google", source: "mail", icon: "mail" },
  { slug: "google-calendar", key: "googleCalendar", provider: "google", source: "calendar", icon: "calendar" },
  { slug: "google-drive", key: "googleDrive", provider: "google", source: "drive", icon: "folder" },
  { slug: "google-meet", key: "googleMeet", provider: "google", source: "meet", icon: "video" },
  { slug: "outlook-mail", key: "outlookMail", provider: "microsoft", source: "mail", icon: "mail" },
  { slug: "outlook-calendar", key: "outlookCalendar", provider: "microsoft", source: "calendar", icon: "calendar" },
] as const satisfies readonly IntegrationEntry[];

/**
 * What the product OFFERS — filtered by the producer's own list, so "we just
 * go with the google for now" stays one edit in core's vocabulary rather than
 * a hand-pruned copy here.
 */
export const INTEGRATIONS = ALL_INTEGRATIONS.filter((entry) =>
  (OFFERED_CONNECTOR_PROVIDERS as readonly string[]).includes(entry.provider));

export function integrationBySlug(slug: string): IntegrationEntry | undefined {
  return INTEGRATIONS.find((entry) => entry.slug === slug);
}

/**
 * Names and descriptions resolved as LITERAL keys, in one place for both
 * screens. The catalogue parity check only sees literal `t("…")` calls by
 * design, so a key built from the entry's own `key` field would be a key
 * nothing guards — and a missing one renders its own dotted path on screen,
 * in the locale nobody is reading.
 */
export function useIntegrationCopy(): Record<
  IntegrationEntry["key"],
  { name: string; description: string }
> {
  const t = useTranslations("integrations");
  return {
    gmail: { name: t("gmail"), description: t("gmailDesc") },
    googleCalendar: { name: t("googleCalendar"), description: t("googleCalendarDesc") },
    googleDrive: { name: t("googleDrive"), description: t("googleDriveDesc") },
    googleMeet: { name: t("googleMeet"), description: t("googleMeetDesc") },
    outlookMail: { name: t("outlookMail"), description: t("outlookMailDesc") },
    outlookCalendar: { name: t("outlookCalendar"), description: t("outlookCalendarDesc") },
  };
}

/**
 * ZWNJ joins words for a reader, not for a typist: «جی‌میل» is one word on
 * screen and «جیمیل» is what somebody types, and a search that answers "no
 * results" for text plainly on the page is worse than no search.
 */
export function foldSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/‌/g, "");
}
