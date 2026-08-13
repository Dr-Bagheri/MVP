"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

/**
 * Audit log drains (M25, Settings · COMPLIANCE) — **named, not fabricated.**
 *
 * A drain ships audit records to an external destination automatically. It is
 * not built. This page says so and stops, and the restraint is the design
 * rather than a gap in it.
 *
 * ── What this deliberately does NOT render ──────────────────────────────────
 *
 * **No form, not even a disabled one.** The Settings copy already states the
 * house rule for exactly this situation: a form that looks like it saved and
 * saved nothing is worse than a disabled one. A disabled form is only slightly
 * better — it still asserts that the fields it shows are the fields that will
 * exist, which is a design decision nobody has made yet.
 *
 * **No empty list of drains.** This is the trap worth naming, because an empty
 * table is what "a shell in the same pattern" usually means and it would be a
 * lie of exactly the kind this surface exists to avoid. "You have no drains
 * configured" is a claim about the ORGANIZATION; the truth is "drains cannot
 * be configured", a claim about the PRODUCT. Rendered, the two are identical —
 * an empty table with a hopeful header — and only one of them is true. Same
 * distinction as an empty audit feed reading as "nothing ever happened here".
 *
 * **No invented destinations, retry policy, or format.** Naming S3 and syslog
 * would be a roadmap we would then have to keep.
 *
 * ── What it DOES do ─────────────────────────────────────────────────────────
 *
 * Points at the mechanism that already works. Webhook delivery is live —
 * signed, retried, with a visible delivery log — and it is what drains will be
 * built on. Someone who needs audit records moved off the platform today has a
 * real answer, and it is one click away instead of one support conversation.
 * That link is the only thing on this page making a claim, and the claim is
 * true.
 */
export function AuditLogDrains() {
  const t = useTranslations("drains");

  return (
    <div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-sm font-medium text-fg">{t("notBuiltTitle")}</p>
        <p className="mt-1 text-sm leading-7 text-fg-muted">{t("notBuiltBody")}</p>
      </div>

      <div className="mt-4">
        <h3 className="mb-1 text-sm font-semibold text-fg">{t("todayTitle")}</h3>
        <p className="mb-3 text-sm leading-7 text-fg-muted">{t("todayBody")}</p>
        <Link href="/management/connectors" className="btn-secondary h-10 min-h-0 px-4 text-sm">
          {t("openConnectors")}
        </Link>
      </div>
    </div>
  );
}
