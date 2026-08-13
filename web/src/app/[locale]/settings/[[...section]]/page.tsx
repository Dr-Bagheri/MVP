"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AuditLogDrains } from "@/components/platform/AuditLogDrains";
import { AuditLogs } from "@/components/platform/AuditLogs";
import { GeneralSettings } from "@/components/platform/GeneralSettings";
import { TwoPane } from "@/components/platform/TwoPane";

/**
 * Settings (M25). Structure adopted from the user's reference; visual design is
 * ours.
 *
 * **The rule that shapes this file: a section that isn't built says so.**
 *
 * M25 rules SSO and Legal Documents as "honest visible-but-inactive entries —
 * named, not fabricated". The IA is complete so the shape of the product is
 * legible, and the entries that have nothing behind them render an explicit
 * state rather than an empty panel that looks like a loading failure, or —
 * worse — placeholder rows that look like data.
 *
 * This is the same rule as "no invented app tiles" on the hub, one surface
 * along: a fabricated capability in a settings menu is a promise the product
 * has to keep.
 */

/**
 * `ready` — built and wired.
 * `elsewhere` — real, but it lives on another surface; we link rather than
 *   duplicate, because two homes for one feature is two states to disagree.
 * `awaiting` — ruled REAL and not yet wired; the backend surface is named so
 *   the entry is a promise with an owner rather than a vague "soon".
 * `not-in-v1` — deliberately excluded from v1. Named, never faked.
 */
type SectionState = "ready" | "elsewhere" | "awaiting" | "not-in-v1";

interface Section {
  slug: string;
  group: "configuration" | "connections" | "compliance";
  state: SectionState;
  /** For `elsewhere`: where the real surface lives. */
  href?: string;
}

const SECTIONS: readonly Section[] = [
  { slug: "general", group: "configuration", state: "ready" },
  { slug: "security", group: "configuration", state: "awaiting" },
  { slug: "sso", group: "configuration", state: "not-in-v1" },
  { slug: "oauth-apps", group: "connections", state: "elsewhere", href: "/connectors" },
  /* live on `GET /v1/admin/audit` — the section that stopped being a promise */
  { slug: "audit-logs", group: "compliance", state: "ready" },
  { slug: "audit-log-drains", group: "compliance", state: "awaiting" },
  { slug: "legal", group: "compliance", state: "not-in-v1" },
];

const GROUPS = ["configuration", "connections", "compliance"] as const;

export default function SettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const t = useTranslations("settings");
  const { section } = use(params);
  const slug = section?.[0] ?? "general";
  const active = SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0]!;

  const groups = GROUPS.map((group) => ({
    key: group,
    title: t(`group.${group}`),
    items: SECTIONS.filter((s) => s.group === group).map((s) => ({
      slug: s.slug,
      href: `/settings/${s.slug}`,
      label: t(`section.${s.slug}`),
      ...(s.state === "awaiting" || s.state === "not-in-v1"
        ? { badge: t(s.state === "awaiting" ? "badgeSoon" : "badgeNotV1") }
        : {}),
    })),
  }));

  return (
    <TwoPane navLabel={t("title")} heading={t("title")} groups={groups} activeSlug={active.slug}>
      <div className="card">
        <h2 className="h-section mb-1">{t(`section.${active.slug}`)}</h2>
        <p className="mb-4 text-sm leading-7 text-fg-muted">{t(`desc.${active.slug}`)}</p>

        {active.state === "elsewhere" && active.href ? (
          <Link href={active.href} className="btn-primary h-10 min-h-0 px-4 text-sm">
            {t("openSurface")}
          </Link>
        ) : null}

        {/*
          `audit-log-drains` stays `awaiting` — the menu badge is correct, it
          genuinely isn't built — but it has its own page rather than the
          generic card, because it has something true and useful to say: the
          webhook mechanism it will be built on works today. Every other
          awaiting section has nothing to add beyond "not yet".
        */}
        {active.state === "awaiting" && active.slug !== "audit-log-drains" ? (
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-sm font-medium text-fg">{t("awaitingTitle")}</p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{t(`awaiting.${active.slug}`)}</p>
          </div>
        ) : null}

        {active.slug === "audit-log-drains" ? <AuditLogDrains /> : null}

        {active.state === "not-in-v1" ? (
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-sm font-medium text-fg">{t("notInV1Title")}</p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{t(`notInV1.${active.slug}`)}</p>
          </div>
        ) : null}

        {active.state === "ready" && active.slug === "general" ? <GeneralSettings /> : null}
        {active.state === "ready" && active.slug === "audit-logs" ? <AuditLogs /> : null}
      </div>
    </TwoPane>
  );
}
