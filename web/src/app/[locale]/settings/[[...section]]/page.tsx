"use client";

import { use } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { TwoPane } from "@/components/platform/TwoPane";
import { SETTINGS_SECTIONS, useSettingsGroups } from "@/components/platform/SettingsPane";
import { PageHeader, Section } from "@/components/scaffold";

/**
 * Settings (M25, anatomy M26) — and since Part 3, EVERY section is real.
 *
 * The "a section that isn't built says so" rule shaped this file through two
 * milestones of honest badges; Part 3 closed it from the other side — the
 * badges left because the absences did. Security states the deployment's
 * actual posture; SSO became Sign-in methods (the live inventory, renamed to
 * what it truthfully is); Legal renders the platform's actual commitments.
 * (Audit log drains was a section here until 2026-08-29: it managed webhooks,
 * and it went when the webhook feature did — its dispatcher had never been
 * registered, so no drain it created could ever have delivered.) The badge
 * MECHANISM survives in the menu component for whatever future section
 * arrives unbuilt — no current section uses it, which is the point.
 *
 * `elsewhere` remains for oauth-apps: the connectors surface is its real
 * home, and two homes for one feature is two states to disagree.
 *
 * **One pane is rendered and one pane is loaded.** This file imported all
 * seven statically, so opening General downloaded the audit feed, the legal
 * documents, the sign-in inventory and the rest — a single URL paying for
 * seven screens, six of which it will not draw. Each is a `next/dynamic`
 * boundary now; the seventh loads when its slug is the active one.
 *
 * **SSR is left ON.** The first version of this passed `{ ssr: false }`, on
 * the belief that every pane fetches on mount and its server pass was an empty
 * shell anyway. Two things were wrong with that. `LegalDocuments` has no
 * effects and no state — it renders the platform's commitments as static text,
 * which SSR delivers in the HTML and `ssr: false` would have withheld until
 * the bundle landed. And the saving it was supposed to buy does not exist:
 * built both ways, this route's first-load JS came out 665,274 B with SSR and
 * 665,323 B without it. An unmounted dynamic component is not fetched either
 * way, which is where the whole win comes from; the flag only decides whether
 * the ACTIVE pane gets server-rendered, and there is no reason to want it not
 * to be.
 */
const GeneralSettings = dynamic(
  () => import("@/components/platform/GeneralSettings").then((m) => m.GeneralSettings),
);
const AssistantSettings = dynamic(
  () => import("@/components/platform/AssistantSettings").then((m) => m.AssistantSettings),
);
const NotificationsSettings = dynamic(
  () => import("@/components/platform/NotificationsSettings").then((m) => m.NotificationsSettings),
);
const SecuritySettings = dynamic(
  () => import("@/components/platform/SecuritySettings").then((m) => m.SecuritySettings),
);
const SignInMethods = dynamic(
  () => import("@/components/platform/SignInMethods").then((m) => m.SignInMethods),
);
const AuditLogs = dynamic(
  () => import("@/components/platform/AuditLogs").then((m) => m.AuditLogs),
);
const LegalDocuments = dynamic(
  () => import("@/components/platform/LegalDocuments").then((m) => m.LegalDocuments),
);

export default function SettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const t = useTranslations("settings");
  const { section } = use(params);
  const slug = section?.[0] ?? "general";
  const active = SETTINGS_SECTIONS.find((s) => s.slug === slug) ?? SETTINGS_SECTIONS[0]!;

  const groups = useSettingsGroups();

  return (
    <TwoPane
      navLabel={t("title")}
      heading={t("title")}
      groups={groups}
      activeSlug={active.slug}
      /*
       * ONE WIDTH for every section (user directive, 2026-09-02: the audit
       * page's menu "got out of position"). Audit Logs was the product's only
       * caller of the wide column, and the cost was that the same toolbar sat
       * at one width on seven sections and another on the eighth — a control
       * that moves between siblings has to be re-found every time.
       * A dense table does not need a wider page: DataTable scrolls inside
       * its own box, which is the whole reason that wrapper exists.
       */
      /* SMALL, the meeting-plan column (user directive, 2026-09-02: "with
       * small page as a template"). Settings is a set of switches and fields,
       * not a list — at the list width a label sat a screen away from the
       * control it named. */
      width="small"
    >
      <PageHeader title={t(`section.${active.slug}`)} subtitle={t(`desc.${active.slug}`)} />

      {active.href ? (
        <Section>
          <Link href={active.href} className="btn-primary">
            {t("openSurface")}
          </Link>
        </Section>
      ) : null}

      {active.slug === "general" ? (
        <Section>
          <GeneralSettings />
        </Section>
      ) : null}
      {active.slug === "assistant" ? (
        <Section>
          <AssistantSettings />
        </Section>
      ) : null}
      {active.slug === "notifications" ? (
        <Section>
          <NotificationsSettings />
        </Section>
      ) : null}
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
      {active.slug === "legal" ? (
        <Section>
          <LegalDocuments />
        </Section>
      ) : null}
    </TwoPane>
  );
}
