"use client";

import { useTranslations } from "next-intl";
import type { ConnectorProvider } from "@/api/types";
import type { IconName } from "@/components/icons";
import { OFFERED_CONNECTOR_PROVIDERS } from "@echo/core/vocabulary";

/**
 * THE integrations catalogue — one list shared by the shelf, the detail page
 * and the connect dialog (user directive, 2026-08-28: "add google meet, google
 * drive, gmail there as well … when you click … it must show like the image";
 * 2026-09-06: "built these: Zoom, Slack, Telegram, Jira, Notion, GitHub,
 * WhatsApp Business, Dropbox/OneDrive, and a generic MCP connector").
 *
 * One ENTRY is one tile. Google's grant fans out into four tiles because its
 * four sources are four different things a person connects for; a registry
 * provider is ONE tile whose detail page switches between its sources — the
 * shape the user named ("Zoom", not "Zoom meetings" and "Zoom recordings").
 *
 * `sources` is the WIRE's vocabulary, verbatim: each becomes the last segment
 * of `GET /v1/connectors/:provider/:source` (core/src/api/connector-providers
 * .ts names them per provider). `kind` says how the connection is made —
 * `oauth` leaves the page for the provider's consent screen, `token` asks for
 * the fields the registry names and asks the provider to vouch for them.
 *
 * `slug` is the URL address (`/integrations/[slug]`) — kebab-case because it
 * is read by people in an address bar, where `googleCalendar` reads as code.
 */
export type IntegrationSource =
  | "mail" | "calendar" | "drive" | "meet"
  | "meetings" | "recordings" | "channels" | "mentions" | "updates" | "issues" | "projects"
  | "pages" | "databases" | "pulls" | "repos" | "profile" | "templates" | "files" | "tools" | "resources";

export type TokenField = "secret" | "url" | "phone_number_id" | "waba_id";

export interface IntegrationEntry {
  /** the address: /integrations/<slug> */
  slug: string;
  /** message-key base in the `integrations` namespace (name + `${key}Desc`) */
  key: "gmail" | "googleCalendar" | "googleDrive" | "googleMeet" | "outlookMail" | "outlookCalendar"
    | "zoom" | "slack" | "telegram" | "jira" | "notion" | "github" | "whatsapp" | "dropbox" | "mcp";
  provider: ConnectorProvider;
  /** the primary source — the detail page opens on it */
  source: IntegrationSource;
  /** every source the detail page can switch between, the primary first */
  sources: readonly IntegrationSource[];
  /** the house icon, drawn only where a provider has no mark of its own */
  icon: IconName;
  kind: "oauth" | "token";
  /** what a token connection asks the person for; empty for OAuth */
  tokenFields: readonly { name: TokenField; required: boolean }[];
}

const oauth = { kind: "oauth", tokenFields: [] } as const;

/**
 * Every integration the platform's code CAN speak, once each. Drive and Meet
 * exist only for Google — they are lenses on the one Google grant, not
 * providers of their own, and the server 400s them for Microsoft.
 */
export const ALL_INTEGRATIONS = [
  { slug: "gmail", key: "gmail", provider: "google", source: "mail", sources: ["mail"], icon: "mail", ...oauth },
  { slug: "google-calendar", key: "googleCalendar", provider: "google", source: "calendar", sources: ["calendar"], icon: "calendar", ...oauth },
  { slug: "google-drive", key: "googleDrive", provider: "google", source: "drive", sources: ["drive"], icon: "folder", ...oauth },
  { slug: "google-meet", key: "googleMeet", provider: "google", source: "meet", sources: ["meet"], icon: "video", ...oauth },
  { slug: "outlook-mail", key: "outlookMail", provider: "microsoft", source: "mail", sources: ["mail"], icon: "mail", ...oauth },
  { slug: "outlook-calendar", key: "outlookCalendar", provider: "microsoft", source: "calendar", sources: ["calendar"], icon: "calendar", ...oauth },
  { slug: "zoom", key: "zoom", provider: "zoom", source: "meetings", sources: ["meetings", "recordings"], icon: "video", ...oauth },
  { slug: "slack", key: "slack", provider: "slack", source: "channels", sources: ["channels", "mentions"], icon: "send", ...oauth },
  { slug: "telegram", key: "telegram", provider: "telegram", source: "updates", sources: ["updates"], icon: "send", kind: "token",
    tokenFields: [{ name: "secret", required: true }] },
  { slug: "jira", key: "jira", provider: "jira", source: "issues", sources: ["issues", "projects"], icon: "check", ...oauth },
  { slug: "notion", key: "notion", provider: "notion", source: "pages", sources: ["pages", "databases"], icon: "fileText", ...oauth },
  { slug: "github", key: "github", provider: "github", source: "issues", sources: ["issues", "pulls", "repos"], icon: "chip", ...oauth },
  { slug: "whatsapp", key: "whatsapp", provider: "whatsapp", source: "profile", sources: ["profile", "templates"], icon: "send", kind: "token",
    tokenFields: [{ name: "secret", required: true }, { name: "phone_number_id", required: true }, { name: "waba_id", required: false }] },
  { slug: "dropbox", key: "dropbox", provider: "dropbox", source: "files", sources: ["files"], icon: "folder", ...oauth },
  { slug: "mcp", key: "mcp", provider: "mcp", source: "tools", sources: ["tools", "resources"], icon: "chip", kind: "token",
    tokenFields: [{ name: "url", required: true }, { name: "secret", required: false }] },
] as const satisfies readonly IntegrationEntry[];

/**
 * What the product OFFERS — filtered by the producer's own list, so "we just
 * go with the google for now" (and, since 2026-09-06, the registry's nine)
 * stays one edit in core's vocabulary rather than a hand-pruned copy here.
 */
export const INTEGRATIONS: readonly IntegrationEntry[] = ALL_INTEGRATIONS.filter((entry) =>
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
    zoom: { name: t("zoom"), description: t("zoomDesc") },
    slack: { name: t("slack"), description: t("slackDesc") },
    telegram: { name: t("telegram"), description: t("telegramDesc") },
    jira: { name: t("jira"), description: t("jiraDesc") },
    notion: { name: t("notion"), description: t("notionDesc") },
    github: { name: t("github"), description: t("githubDesc") },
    whatsapp: { name: t("whatsapp"), description: t("whatsappDesc") },
    dropbox: { name: t("dropbox"), description: t("dropboxDesc") },
    mcp: { name: t("mcp"), description: t("mcpDesc") },
  };
}

/** every source's own word — literal keys, same reason as the names above */
export function useSourceLabels(): Record<IntegrationSource, string> {
  const t = useTranslations("integrations");
  return {
    mail: t("source_mail"), calendar: t("source_calendar"), drive: t("source_drive"), meet: t("source_meet"),
    meetings: t("source_meetings"), recordings: t("source_recordings"), channels: t("source_channels"),
    mentions: t("source_mentions"), updates: t("source_updates"), issues: t("source_issues"),
    projects: t("source_projects"), pages: t("source_pages"), databases: t("source_databases"),
    pulls: t("source_pulls"), repos: t("source_repos"), profile: t("source_profile"),
    templates: t("source_templates"), files: t("source_files"), tools: t("source_tools"),
    resources: t("source_resources"),
  };
}

/**
 * The PROVIDER's name, for the sentences that name one («اتصال گوگل», the
 * connected table's app filter). Google and Microsoft have their one
 * spelling in the workflows catalogue; a registry provider IS its single
 * integration, so its tile's name is the provider's name.
 */
export function providerLabelFor(
  entry: IntegrationEntry,
  copy: ReturnType<typeof useIntegrationCopy>,
  tw: (key: "google" | "microsoft") => string,
): string {
  if (entry.provider === "google") return tw("google");
  if (entry.provider === "microsoft") return tw("microsoft");
  return copy[entry.key].name;
}

/**
 * ZWNJ joins words for a reader, not for a typist: «جی‌میل» is one word on
 * screen and «جیمیل» is what somebody types, and a search that answers "no
 * results" for text plainly on the page is worse than no search.
 */
export function foldSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/\u200c/g, "");
}
