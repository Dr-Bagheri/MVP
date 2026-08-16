"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ManagementPane } from "@/components/platform/ManagementPane";
import { Card } from "@/components/ui";

/**
 * Management — the platform-level admin surface (M25).
 *
 * Skills and Connectors moved here from the top-level nav by user directive.
 * They are LINKED, not re-implemented: both surfaces exist and work, and a
 * second copy under a new route is two states to disagree.
 *
 * Server management is named and honestly marked as unwired. Its reads —
 * queue depths, dead letters, provider/key health, storage usage — are core/'s
 * and are queued rather than landed. A dashboard with placeholder gauges would
 * be worse than an empty one: a fabricated number in an operations surface is
 * a number someone will act on.
 */
/*
 * Every section the sidebar lists appears here too. `models` was missing while
 * the menu had no Models entry to contradict — the two-pane rebuild made the
 * gap visible, which is the argument for one nav model rather than two lists
 * that only disagree once someone looks at both.
 *
 * `ready: false` on models is not a placeholder: the page reads the list and
 * cannot save a change to it, and its own notice says so.
 */
const SECTIONS = [
  { key: "users", href: "/management/users", ready: true },
  { key: "skills", href: "/management/skills", ready: true },
  { key: "models", href: "/management/models", ready: true },
  { key: "connectors", href: "/management/connectors", ready: true },
  /* wired by FE3 against `GET /v1/admin/server` — per-metric `measured_at`,
     so a real zero and a not-measured render differently */
  { key: "server", href: "/management/server", ready: true },
] as const;

export default function ManagementPage() {
  const t = useTranslations("management");

  return (
    /*
     * `activeSlug=""` — on the landing itself no section is current, and
     * marking one would claim you are somewhere you are not.
     */
    <ManagementPane activeSlug="">
      <p className="mb-4 text-sm leading-7 text-fg-muted">{t("intro")}</p>

      {/*
        The cards stay, and they are NOT the menu repeated: the sidebar gives
        each section its name, these give what it is FOR. Dropping them would
        make this landing an empty pane; turning them into the navigation again
        would be two homes for one nav, which is the thing the sidebar just
        fixed.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href} className="block">
            <Card className="h-full">
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-fg">{t(`section.${s.key}`)}</h2>
                {!s.ready ? (
                  <span className="chip bg-surface-2 text-[10px] text-fg-muted">
                    {t("notWired")}
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-fg-muted">{t(`desc.${s.key}`)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </ManagementPane>
  );
}
