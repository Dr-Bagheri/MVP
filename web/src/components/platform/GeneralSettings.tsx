"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Field } from "@/components/ui";
import { Select } from "@/components/Select";
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
 *
 * **Audit findings, 2026-09-02 — two spellings of one habit: re-answering a
 * question the theme had already answered.** The three selects wore
 * `input h-10 min-h-0 text-sm` on top of `.input`, which pins 40px at every
 * width — throwing away the 44px hit area the class deliberately keeps below
 * md — and bumps the field type off the theme's 12.5 detail step. That is the
 * same override the Audit Logs filter was stripped of, for the same reason:
 * `.input`'s whole job is to say how tall a field is, and a local answer only
 * makes one screen disagree with the rest. The calendar and timezone labels
 * were a hand-rolled `text-xs font-medium text-fg-subtle` span — a THIRD
 * spelling of a form label beside `Field`'s `text-sm font-medium text-fg` and
 * scaffold's `FormRow`, so labels changed size and tone between General and
 * Assistant on one settings page. Both now use the theme's own answers: bare
 * `.input`, and `Field` from @/components/ui (which also carries the
 * `aria-describedby` wiring, should either field ever earn a hint).
 *
 * The theme select keeps its `sr-only` span rather than joining them: `Field`
 * renders a VISIBLE label, and this one's visible label is the card's heading.
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
            {/* THE PLATFORM'S ONE DROPDOWN (user directive, 2026-09-03: "the
                dropdown I accepted to be the default in the whole platform was
                the way the meeting page dropdowns are").
                A native `<select>` wearing `.input` matches the field's box and
                nothing else: the browser draws the panel, in the browser's own
                colours, with the browser's own row heights — which in dark
                theme is a white list under a dark control. `Select` is the
                themed one the meeting page already uses, and using it here is
                what makes the platform have A dropdown rather than two. */}
            <Select
              ariaLabel={t("theme")}
              value={theme}
              onChange={(next) => storeTheme(next as Theme)}
              options={[
                { value: "dark", label: t("themeDark") },
                { value: "light", label: t("themeLight") },
              ]}
            />
          </label>
        </div>
      </Card>

      {/* ── calendar · timezone ─────────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("generalLocaleTitle")}</h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("generalLocaleHint")}</p>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          {/* audit finding, 2026-09-02: the theme's `Field`, not a third
              spelling of a form label */}
          <Field label={tAvatar("calendar")}>
            <Select
              value={calendar}
              onChange={(next) => {
                setSaveFailed(false);
                void saveCalendarPreference(next as CalendarPreference)
                  .catch(() => setSaveFailed(true));
              }}
              options={[
                { value: "auto", label: tAvatar("calendarAuto") },
                { value: "jalali", label: tAvatar("calendarJalali") },
                { value: "gregorian", label: tAvatar("calendarGregorian") },
              ]}
            />
          </Field>
          <Field label={tAvatar("timezone")}>
            <Select
              value={timezone}
              onChange={(next) => {
                setSaveFailed(false);
                void saveTimezonePreference(next)
                  .catch(() => setSaveFailed(true));
              }}
              options={[
                { value: "auto", label: tAvatar("timezoneAuto") },
                ...TIMEZONES.map((zone) => ({ value: zone, label: zone })),
              ]}
            />
          </Field>
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
