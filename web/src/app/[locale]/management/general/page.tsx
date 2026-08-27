"use client";

import { useTranslations } from "next-intl";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { PageHeader, Section } from "@/components/scaffold";
import { OrgFields } from "@/components/platform/OrgFields";

/**
 * MANAGEMENT · GENERAL — the organisation's own page (user directive,
 * 2026-08-26: "add a General for the landing page in Management").
 *
 * The org fields LEFT Settings in the same directive. Settings is where a
 * person configures the product for themselves; who the organisation is —
 * its name, its public face, its logo — is a fact about the organisation,
 * and Management is where the organisation is administered. One home, and
 * the move is why Settings · General no longer carries them.
 */
export default function ManagementGeneralPage() {
  const t = useTranslations("management");
  return (
    <ManagementPane activeSlug="general">
      <PageHeader title={t("section.general")} subtitle={t("desc.general")} />
      <Section>
        <OrgFields />
      </Section>
    </ManagementPane>
  );
}
