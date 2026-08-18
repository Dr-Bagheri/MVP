"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { FormPanel, FormRow } from "@/components/scaffold";

/**
 * Settings · Security — a compact index of the security controls that have a
 * home elsewhere. The password change lives on Profile and sign-in provider
 * management lives on Sign-in methods, so this page does not duplicate either
 * control or its state.
 */
export function SecuritySettings() {
  const t = useTranslations("security");

  return (
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
  );
}
