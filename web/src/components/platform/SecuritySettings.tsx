"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { FormPanel, FormRow } from "@/components/scaffold";

/**
 * Settings · Security (Part 3) — every row is a TRUE statement about this
 * deployment or a real control, and nothing else. The section's old
 * "Not yet" badge is retired by content, not by decoration: what a security
 * page owes its reader is the facts of the wall they are standing behind,
 * stated plainly, each one something the codebase actually enforces.
 *
 * The password change lives on Profile and is LINKED, not duplicated — two
 * homes for one control is two states to disagree (the theme lesson).
 */
export function SecuritySettings() {
  const t = useTranslations("security");

  const facts: { key: string }[] = [
    { key: "session" },   // httpOnly cookie, browser never holds a token (M1)
    { key: "cache" },     // no-store + Back-after-sign-out killed
    { key: "oauth" },     // PKCE, server-side code exchange
    { key: "rls" },       // RLS + role grants are the wall; prompts never are
    { key: "agent" },     // the assistant borrows the caller's authority
    { key: "logs" },      // content never in logs, codes only
  ];

  return (
    <div className="space-y-6">
      <FormPanel>
        <FormRow label={t("passwordLabel")} description={t("passwordHint")}>
          <Link href="/profile" className="btn-secondary h-10 min-h-0 px-4 text-sm">
            {t("passwordAction")}
          </Link>
        </FormRow>
        <FormRow label={t("methodsLabel")} description={t("methodsHint")}>
          <Link href="/settings/sso" className="btn-secondary h-10 min-h-0 px-4 text-sm">
            {t("methodsAction")}
          </Link>
        </FormRow>
      </FormPanel>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">{t("postureTitle")}</h3>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {facts.map((f) => (
            <div key={f.key} className="px-5 py-3">
              <p className="text-sm font-medium text-fg">{t(`fact_${f.key}`)}</p>
              <p className="mt-0.5 text-detail leading-6 text-fg-muted">{t(`fact_${f.key}_note`)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
