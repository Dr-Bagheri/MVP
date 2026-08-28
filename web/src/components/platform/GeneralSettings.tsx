"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { Card, Chip } from "@/components/ui";
import { Link } from "@/i18n/routing";
import { formatDate } from "@/lib/format";
import { saveCalendarPreference, saveTimezonePreference } from "@/lib/preferences";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import type { CalendarPreference } from "@/lib/preferences";

/**
 * Settings·General, rebuilt (user directive, 2026-08-28: "general setting
 * is empty, put the general thing you think that needed here" — the page
 * had emptied when the autonomy dial, its only control, left the product).
 *
 * Two ideas, both bounded by what the wire actually serves:
 *
 * **The workspace, as facts.** Name, your role, your handle, member-since —
 * read from `me()`, which every member may call. Deliberately READ-ONLY:
 * the organization's identity is edited on its own Management page (user
 * ruling, 2026-08-27, when identity LEFT this screen), and a second
 * editable copy would be the two-writers drift this repo keeps burying.
 *
 * **Calendar and timezone.** The two preferences a person reaches for
 * first, previously living only in the avatar menu — a settings page is
 * where people go LOOKING for them, so the same store answers here too:
 * the identical save-then-adopt functions, CONSUMED, never forked (a
 * second copy of a preference writer is two sources for one fact).
 */
export function GeneralSettings() {
  const t = useTranslations("settings");
  const tAvatar = useTranslations("platform");
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-5">
      {/* ── the workspace, as facts ─────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("generalWorkspaceTitle")}</h2>
        <dl className="mt-3 space-y-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-40 text-fg-muted">{t("generalWorkspaceName")}</dt>
            <dd className="font-medium text-fg">{me?.org_name ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-40 text-fg-muted">{t("generalYourRole")}</dt>
            <dd>{me ? <Chip tone="accent">{t(`role_${me.role}`)}</Chip> : "—"}</dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-40 text-fg-muted">{t("generalYourHandle")}</dt>
            <dd dir="ltr" className="font-mono text-fg">
              {me?.username ? `@${me.username}` : "—"}
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-40 text-fg-muted">{t("generalMemberSince")}</dt>
            <dd className="text-fg">{me ? formatDate(me.created_at, locale) : "—"}</dd>
          </div>
        </dl>
        {(me?.role === "admin" || me?.role === "owner") ? (
          <p className="mt-3 text-xs text-fg-subtle">
            {t("generalIdentityNote")}{" "}
            <Link href="/management" className="text-accent hover:underline">
              {t("generalIdentityLink")}
            </Link>
          </p>
        ) : null}
      </Card>

      {/* ── calendar · timezone ─────────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("generalLocaleTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("generalLocaleHint")}</p>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-subtle">
              {tAvatar("calendar")}
            </span>
            <select
              className="input h-10 min-h-0 text-sm"
              value={calendar}
              onChange={(changeEvent) => {
                setSaveFailed(false);
                void saveCalendarPreference(changeEvent.target.value as CalendarPreference)
                  .catch(() => setSaveFailed(true));
              }}
            >
              <option value="auto">{tAvatar("calendarAuto")}</option>
              <option value="jalali">{tAvatar("calendarJalali")}</option>
              <option value="gregorian">{tAvatar("calendarGregorian")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-subtle">
              {tAvatar("timezone")}
            </span>
            <select
              className="input h-10 min-h-0 text-sm"
              value={timezone}
              onChange={(changeEvent) => {
                setSaveFailed(false);
                void saveTimezonePreference(changeEvent.target.value)
                  .catch(() => setSaveFailed(true));
              }}
            >
              <option value="auto">{tAvatar("timezoneAuto")}</option>
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>
        </div>
        {/* the control still shows the OLD value, which is true — this says
            why, instead of leaving a change that silently didn't happen */}
        {saveFailed ? (
          <p role="alert" className="mt-2 text-[11px] leading-5 text-danger">
            {tAvatar("preferenceSaveFailed")}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/** the avatar menu's short list, same reasoning: a 400-entry select is
    unusable, and «Auto» already covers everyone whose clock is right */
const TIMEZONES = [
  "Asia/Tehran",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
] as const;
