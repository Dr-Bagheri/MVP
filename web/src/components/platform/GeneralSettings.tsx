"use client";

import { memo, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { routing, usePathname, useRouter, type Locale } from "@/i18n/routing";
import { Card, Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { saveCalendarPreference, saveTimezonePreference } from "@/lib/preferences";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import type { CalendarPreference } from "@/lib/preferences";
import { notifyError } from "@/lib/notify";
import { formatDate, formatTimeSeconds } from "@/lib/format";
import { TIMEZONES, timezoneLabelKey } from "@/lib/timezones";

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
 * — the one store the profile page already writes — rather than introducing
 * a third opinion about the document's theme. That is not tidiness: this
 * platform has already shipped the bug where two stores held one theme, so
 * the pre-paint script read a key the toggle never wrote and caused the
 * exact flash it exists to prevent. The store offers two values, `light`
 * and `dark`, so those are the two options; there is no `system` because
 * there is nothing behind it.
 *
 * **Language** (user directive, 2026-09-16: "remove the fa, en version from
 * the top menu and put it in settings general page; the default language is
 * persian"). The top bar's pair is gone and this card is the one home. The
 * options are `routing.locales` — the producer's own list, so a third
 * language added to the router appears here without a second list to edit —
 * and the change keeps the pair's one rule: the SAME route under the other
 * prefix, so nobody loses their place for a preference. The choice also
 * follows the person to their next device through their profile row
 * (`app_user.locale`), best effort: a refused save must not stop the screen
 * changing language in front of them.
 *
 * **Calendar and timezone** stay as they were: the identical
 * save-then-adopt functions, consumed, never forked. The zones are shown by
 * their catalogue LABELS (user, same day: "this dropdown still is in
 * english, translate it") — `lib/timezones` owns the list and the key rule.
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
 * The theme and language selects keep an `sr-only` span rather than joining
 * them: `Field` renders a VISIBLE label, and each one's visible label is its
 * card's heading.
 */
export function GeneralSettings() {
  const t = useTranslations("settings");
  const tAvatar = useTranslations("platform");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();

  const switchLocale = (next: string) => {
    if (next === locale) return;
    router.replace(pathname, { locale: next as Locale });
    /* lazily, so a screen that never changes language never loads the
       client here, and so the mocked client of a test that asserts "no
       identity read on mount" is left exactly as quiet as it is */
    void import("@/api/client")
      .then(({ api }) => api.setLocale(next))
      .catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      {/* ── theme ───────────────────────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("theme")}</h2>
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

      {/* ── language ────────────────────────────────────────────────── */}
      <Card>
        <h2 className="h-section">{t("language")}</h2>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="sr-only">{t("language")}</span>
            {/* the languages carry the SCREEN's names for them — «فارسی» and
                «انگلیسی» here, "Persian" and "English" there — the same words
                the organisation's default-language row already uses, so the
                two pickers cannot disagree about what a language is called
                and the Persian screen stays Persian (one language per screen,
                2026-09-06) */}
            <Select
              ariaLabel={t("language")}
              value={locale}
              onChange={switchLocale}
              options={routing.locales.map((value) => ({
                value,
                label: value === "fa" ? t("orgLocale_fa") : t("orgLocale_en"),
              }))}
            />
          </label>
        </div>
      </Card>

      {/* ── calendar · timezone ─────────────────────────────────────── */}
      <Card>
        {/* THE CLOCK AT THE TITLE'S OTHER END (user, 2026-09-16: "for date
            and time, in the first of the title on the other side put the
            exact date and time too") */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h-section">{t("generalLocaleTitle")}</h2>
          <LiveClock locale={locale} label={t("now")} />
        </div>
        <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
          {/* audit finding, 2026-09-02: the theme's `Field`, not a third
              spelling of a form label */}
          <Field label={tAvatar("calendar")}>
            <Select
              value={calendar}
              onChange={(next) => {
                void saveCalendarPreference(next as CalendarPreference)
                  .catch(() => notifyError(tAvatar("preferenceSaveFailed")));
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
                void saveTimezonePreference(next)
                  .catch(() => notifyError(tAvatar("preferenceSaveFailed")));
              }}
              options={[
                { value: "auto", label: tAvatar("timezoneAuto") },
                /* the id is the VALUE (what is stored, what Intl is asked
                   for); the label is the catalogue's word for it */
                ...TIMEZONES.map((zone) => ({ value: zone, label: tAvatar(timezoneLabelKey(zone)) })),
              ]}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/**
 * The exact date and time, live, rendered through the SAME two functions
 * every other date and time on this platform go through — so the reading IS
 * the two preferences under it, applied: change the calendar and the month
 * changes its name, change the zone and the hour moves, in the same second.
 *
 * Seconds, not minutes, because "exact" was the word — and because the
 * seconds are what shows the reading is alive rather than a stamp taken when
 * the page opened. It mounts EMPTY and fills on the client: the first paint
 * is server-rendered, and a time written on the server would not match the
 * one the browser writes a moment later (a hydration mismatch that reads as
 * a flicker of the wrong minute).
 *
 * MEMOISED, and the reason is the verify-red that came back green: with the
 * parent re-rendering on every preference change (it subscribes for its own
 * selects), the clock's own subscription below could be deleted and the
 * "follows the zone" test stayed green — two copies of one wall, one of them
 * unexercised, the shape this repo has recorded three times. `memo` makes the
 * clock's subscription the ONLY path from the store to this reading: the
 * parent's re-render no longer reaches it (its props do not change), so
 * removing the two hooks is red by name.
 */
const LiveClock = memo(function LiveClock({ locale, label }: { locale: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  /* subscribed, not read: the formatters read the store themselves; these
     hooks are what re-render the reading the moment a preference changes */
  useCalendarPreference();
  useTimezonePreference();
  const iso = now?.toISOString();
  return (
    <time
      dateTime={iso}
      aria-label={label}
      /* tabular digits, so the seconds tick without the date shifting */
      className="badge-num text-detail text-fg-muted"
    >
      {iso ? `${formatDate(iso, locale)} · ${formatTimeSeconds(iso, locale)}` : ""}
    </time>
  );
});
