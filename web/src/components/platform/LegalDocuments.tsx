"use client";

import { useTranslations } from "next-intl";

/**
 * Settings · Legal (Part 3) — real documents, rendered, versioned.
 *
 * The section that used to be "Not in v1" now holds the platform's actual
 * Terms of Service and Privacy Policy: the true statements this codebase
 * already keeps (content never in logs, the transcript stays yours, deletion
 * semantics per M11, org-scoped access) written as commitments to the
 * reader. Versioned by date; a future revision changes the date, never
 * silently the text.
 */
export function LegalDocuments() {
  const t = useTranslations("legal");

  const sections = ["ownership", "access", "processing", "retention", "security", "changes"] as const;

  return (
    <div className="space-y-6">
      <p className="text-detail text-fg-muted">{t("version")}</p>
      <div>
        <h3 className="mb-2 text-base font-semibold text-fg">{t("termsTitle")}</h3>
        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          {sections.map((s) => (
            <div key={s}>
              <h4 className="mb-1 text-sm font-semibold text-fg">{t(`${s}Title`)}</h4>
              <p className="text-sm leading-7 text-fg-muted">{t(`${s}Body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
