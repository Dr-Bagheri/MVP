"use client";

import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui";

/**
 * Settings · Sign-in methods (Part 3) — the section that used to be
 * "Single sign-on (SSO) · Not in v1".
 *
 * It lists only the external providers requested for this surface. Their
 * availability remains a deployment-level setting in the authentication
 * provider; an organisation page must not pretend it can disable OAuth for
 * every visitor.
 */
export function SignInMethods() {
  const t = useTranslations("signin");

  const methods = [
    { key: "google", live: true },
    { key: "github", live: true },
  ] as const;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-7 text-fg-muted">{t("intro")}</p>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {methods.map((m) => (
          <div key={m.key} className="flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{t(`method_${m.key}`)}</p>
              <p className="mt-0.5 text-detail leading-6 text-fg-muted">{t(`method_${m.key}_note`)}</p>
            </div>
            <Chip tone={m.live ? "success" : "neutral"}>{t("active")}</Chip>
          </div>
        ))}
      </div>
    </div>
  );
}
