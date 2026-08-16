"use client";

import { use } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AuditLogDrains } from "@/components/platform/AuditLogDrains";
import { AuditLogs } from "@/components/platform/AuditLogs";
import { GeneralSettings } from "@/components/platform/GeneralSettings";
import { LegalDocuments } from "@/components/platform/LegalDocuments";
import { SecuritySettings } from "@/components/platform/SecuritySettings";
import { SignInMethods } from "@/components/platform/SignInMethods";
import { TwoPane } from "@/components/platform/TwoPane";
import { PageHeader, Section } from "@/components/scaffold";

/**
 * Settings (M25, anatomy M26) — and since Part 3, EVERY section is real.
 *
 * The "a section that isn't built says so" rule shaped this file through two
 * milestones of honest badges; Part 3 closed it from the other side — the
 * badges left because the absences did. Security states the deployment's
 * actual posture; SSO became Sign-in methods (the live inventory, renamed to
 * what it truthfully is); Audit log drains manage real webhooks on the M17
 * dispatcher; Legal renders the platform's actual commitments. The badge
 * MECHANISM survives in the menu component for whatever future section
 * arrives unbuilt — no current section uses it, which is the point.
 *
 * `elsewhere` remains for oauth-apps: the connectors surface is its real
 * home, and two homes for one feature is two states to disagree.
 */
type SectionState = "ready" | "elsewhere";

interface SectionDef {
  slug: string;
  group: "configuration" | "connections" | "compliance";
  state: SectionState;
  href?: string;
}

const SECTIONS: readonly SectionDef[] = [
  { slug: "general", group: "configuration", state: "ready" },
  { slug: "security", group: "configuration", state: "ready" },
  { slug: "sso", group: "configuration", state: "ready" },
  { slug: "oauth-apps", group: "connections", state: "elsewhere", href: "/connectors" },
  { slug: "audit-logs", group: "compliance", state: "ready" },
  { slug: "audit-log-drains", group: "compliance", state: "ready" },
  { slug: "legal", group: "compliance", state: "ready" },
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
    })),
  }));

  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={groups}
      activeSlug={active.slug}
      /* the audit feed is a data-dense table — the blueprint's wide column */
      width={active.slug === "audit-logs" ? "wide" : "default"}
    >
      <PageHeader title={t(`section.${active.slug}`)} subtitle={t(`desc.${active.slug}`)} />

      {active.state === "elsewhere" && active.href ? (
        <Section>
          <Link href={active.href} className="btn-primary">
            {t("openSurface")}
          </Link>
        </Section>
      ) : null}

      {active.slug === "general" ? <GeneralSettings /> : null}
      {active.slug === "security" ? (
        <Section>
          <SecuritySettings />
        </Section>
      ) : null}
      {active.slug === "sso" ? (
        <Section>
          <SignInMethods />
        </Section>
      ) : null}
      {active.slug === "audit-logs" ? (
        <Section>
          <AuditLogs />
        </Section>
      ) : null}
      {active.slug === "audit-log-drains" ? (
        <Section>
          <AuditLogDrains />
        </Section>
      ) : null}
      {active.slug === "legal" ? (
        <Section>
          <LegalDocuments />
        </Section>
      ) : null}
    </TwoPane>
  );
}
