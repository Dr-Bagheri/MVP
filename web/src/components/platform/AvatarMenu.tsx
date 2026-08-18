"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import type { User } from "@/api/types";
import { personName } from "@/lib/format";
import {
  saveCalendarPreference,
  saveTimezonePreference,
  type CalendarPreference,
} from "@/lib/preferences";
import { useCalendarPreference, useTimezonePreference } from "@/lib/usePreferences";
import { storeTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

/**
 * The account menu (user directive, review round 2). Five entries are the
 * floor: identity, Account, Theme, Time and calendar, Sign out.
 *
 * **Theme and the calendar controls are the real controls, not links to them.**
 * The directive is explicit that theme shares ONE state with Settings ·
 * General, and it does — `useTheme()` is a shared store, not a second
 * `useState` reading the same key. Two copies of one setting disagree the
 * moment one is on screen while the other changes it, and the stale one then
 * writes its stale value back.
 *
 * **"Auto (follows language)" is the calendar default and it is load-bearing.**
 * It preserves the locale-solid ruling — Jalali in Persian, Gregorian in
 * English — while letting someone who thinks in one calendar keep it in both
 * languages. A default of "Jalali" would have quietly overridden the ruling
 * for every English user.
 *
 * The identity header is not a link: it says who you are, and making it
 * clickable would give the same destination two entries in a five-entry menu.
 */
export function AvatarMenu({ me }: { me: User | null }) {
  const t = useTranslations("platform");
  const tSettings = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  /*
   * A preference save can be REFUSED (core validates the calendar against its
   * published set and the timezone against what the runtime can render). The
   * store only adopts a value the server accepted, so on failure the control
   * still shows the old one — correct, but silent. This is the line that stops
   * it being silent.
   */
  const [saveFailed, setSaveFailed] = useState(false);
  const theme = useTheme();
  const calendar = useCalendarPreference();
  const timezone = useTimezonePreference();
  const root = useRef<HTMLDivElement>(null);

  /*
   * Close on outside click and on Escape. Without this the menu stays open
   * behind whatever you clicked next, which on a phone means it covers the
   * thing you were trying to reach.
   */
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      // FE1's route, consumed not forked: POST because signing out is a state
      // change and a GET would let any page log the user out with an <img>
      await fetch("/api/auth/sign-out", { method: "POST" });
      /*
       * A HARD navigation, not router.replace: the app router's client cache
       * still holds the signed-in screens' payloads, and a soft navigation
       * would leave them restorable through Back without any request hitting
       * the middleware gate. Tearing the document down is the sign-out.
       */
      window.location.assign(`/${locale}/sign-in`);
    } finally {
      setSigningOut(false);
    }
  }

  const name = personName(me, locale);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="tap grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border-strong bg-surface-2 text-sm font-semibold text-fg"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {me?.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a data URL;
             next/image would proxy an image the payload already carries */
          <img src={me.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          name.trim().charAt(0) || "؟"
        )}
        <span className="sr-only">{t("account")}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-11 z-30 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
          style={{ insetInlineStart: 0 }}
        >
          {/*
            Identity, non-clickable. `me === null` shows nothing rather than a
            skeleton name: an invented placeholder in the one block whose job
            is telling you WHO you are signed in as is the wrong thing to guess.
          */}
          {me ? (
            <div className="border-b border-border px-3 pb-2 pt-1.5">
              <p className="truncate text-sm font-semibold text-fg">{name}</p>
              {/* `ltr` because an address is not Persian text — isolating it
                  keeps the domain from being reordered inside an RTL line */}
              {/* The PARAGRAPH keeps the locale's direction so it aligns
                  with the name above it (right in fa, left in en — user
                  report: the address sat on the far side in Persian);
                  only the address itself is isolated LTR. `.ltr` on the
                  block was the bug: direction:ltr makes text-align:start
                  mean LEFT regardless of the menu's language. */}
              <p className="truncate text-xs text-fg-muted">
                <span className="ltr">{me.email}</span>
              </p>
            </div>
          ) : null}

          <Link
            href="/profile"
            role="menuitem"
            className="mt-1 block rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            {t("account")}
          </Link>

          <Link
            href="/settings"
            role="menuitem"
            className="block rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            {t("settings")}
          </Link>

          {/* Theme — the same state Settings · General edits */}
          <div className="mt-1 border-t border-border px-3 pb-1 pt-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {tSettings("theme")}
            </p>
            <div className="flex gap-1">
              {(["dark", "light"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === option}
                  onClick={() => storeTheme(option as Theme)}
                  className={`tap flex-1 rounded-lg py-1.5 text-xs leading-control transition-colors ${
                    theme === option
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {tSettings(option === "dark" ? "themeDark" : "themeLight")}
                </button>
              ))}
            </div>
          </div>

          {/* Time and calendar — SOLID (user directive): always open, no
              +/- toggle. Two small controls don't earn a hiding place. */}
          <div className="border-t border-border px-3 pb-2 pt-2">
            <p className="px-0 py-1 text-sm text-fg">{t("timeAndCalendar")}</p>

            <div className="mt-1 space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-fg-muted">{t("calendar")}</span>
                  <select
                    // h-11 rather than .tap: a <select> is a replaced element
                    // and renders no ::after, so .tap would sit there looking
                    // satisfied while the target stayed its visual size
                    className="input h-11 min-h-0 text-xs md:h-9"
                    value={calendar}
                    onChange={(e) => {
                      setSaveFailed(false);
                      void saveCalendarPreference(e.target.value as CalendarPreference).catch(() =>
                        setSaveFailed(true),
                      );
                    }}
                  >
                    <option value="auto">{t("calendarAuto")}</option>
                    <option value="jalali">{t("calendarJalali")}</option>
                    <option value="gregorian">{t("calendarGregorian")}</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-fg-muted">{t("timezone")}</span>
                  <select
                    className="input h-11 min-h-0 text-xs md:h-9"
                    value={timezone}
                    onChange={(e) => {
                      setSaveFailed(false);
                      void saveTimezonePreference(e.target.value).catch(() => setSaveFailed(true));
                    }}
                  >
                    <option value="auto">{t("timezoneAuto")}</option>
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </label>

                {/* the control still shows the OLD value, which is true — this
                    says why, rather than leaving a change that silently
                    didn't happen */}
                {saveFailed ? (
                  <p role="alert" className="text-[11px] leading-5 text-danger">
                    {t("preferenceSaveFailed")}
                  </p>
                ) : null}
              </div>
          </div>

          {/* the locale pair lives here below md, and duplicates the bar's
              switcher above it — one control, two homes, never two states */}
          <div className="flex gap-1 border-t border-border px-1 pt-2 md:hidden">
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="menuitem"
                onClick={() => router.replace("/", { locale: l })}
                className={`tap flex-1 rounded-lg py-1.5 text-xs ${
                  l === locale ? "bg-accent-soft font-semibold text-accent" : "text-fg-muted"
                }`}
              >
                {l === "fa" ? "فارسی" : "English"}
              </button>
            ))}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            className="mt-1 block w-full rounded-lg bg-danger/10 px-3 py-2 text-start text-sm text-danger hover:bg-danger/20 disabled:opacity-50"
          >
            {t("signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A short list, not the full IANA set: a 400-entry `<select>` is unusable on a
 * phone, and the honest default («Auto») already covers everyone whose device
 * clock is right. Names are shown raw and LTR because a zone identifier is not
 * translatable text — inventing Persian names for them would be inventing
 * identifiers.
 */
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
