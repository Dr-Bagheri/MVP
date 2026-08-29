"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui";
import { saveCalendarPreference, saveTimezonePreference } from "@/lib/preferences";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import type { CalendarPreference } from "@/lib/preferences";

/**
 * Settings · General — the preferences a person reaches for first, and
 * nothing else.
 *
 * **The workspace card is GONE** (user directive, 2026-08-29: "remove this
 * the workspace section from the general settings"). It rendered name,
 * role, handle and member-since as read-only facts with a pointer at
 * Management, which is where they are actually edited — a second, weaker
 * copy of a screen that already exists. Its `me()` fetch went with it:
 * nothing else on this screen needed an identity, so keeping the request
 * would have been a network call for a card nobody can see.
 *
 * **Theme** (user directive, same day: "add the dark or light theme
 * options in the general settings"). It CONSUMES `useTheme` / `storeTheme`
 * — the one store the avatar menu and the profile page already write —
 * rather than introducing a third opinion about the document's theme.
 * That is not tidiness: this platform has already shipped the bug where
 * two stores held one theme, so the pre-paint script read a key the toggle
 * never wrote and caused the exact flash it exists to prevent. The store
 * offers two values, `light` and `dark`, so those are the two options;
 * there is no `system` because there is nothing behind it.
 *
 * **Calendar and timezone** stay as they were: the identical
 * save-then-adopt functions, consumed, never forked.
 */
export function GeneralSettings() {
  const t = useTranslations("settings");
  const tAvatar = useTranslations("platform");
  const theme = useTheme();
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();
  const [saveFailed, setSaveFailed] = useState(false);

  return (
    <div className="space-y-5">
      {/* ── theme ───────────────────────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("theme")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("themeHint")}</p>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          <label className="block">
            {/* the card's own heading is the visible label — a second
                «پوسته» above the box would be the same word twice */}
            <span className="sr-only">{t("theme")}</span>
            <select
              className="input h-10 min-h-0 text-sm"
              value={theme}
              onChange={(changeEvent) => storeTheme(changeEvent.target.value as Theme)}
            >
              <option value="dark">{t("themeDark")}</option>
              <option value="light">{t("themeLight")}</option>
            </select>
          </label>
        </div>
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
