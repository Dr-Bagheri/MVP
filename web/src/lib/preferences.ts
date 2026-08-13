import {
  CALENDAR_PREFERENCES,
  TIMEZONE_AUTO,
  type CalendarPreference as CoreCalendarPreference,
} from "@echo/core/vocabulary";
import { api } from "@/api/client";
import type { Me } from "@/api/types";

/**
 * Personal display preferences: calendar and timezone (user directive, review
 * round 2 — the avatar menu's "Time and calendar").
 *
 * **`auto` is the default and it preserves the locale-solid ruling.** Dates
 * follow the language — Jalali in Persian, Gregorian in English — until
 * someone says otherwise. An explicit choice overrides it; that is the whole
 * shape of the directive, and it is why the default is a third value rather
 * than "whatever fa happens to mean today".
 *
 * **These are read by `formatDate`/`formatTime` themselves, not passed in.**
 * The alternative — a new argument on every call — means every surface that
 * forgets to pass it silently ignores the preference, which is a setting that
 * does nothing on most of the product while looking like it works. Every call
 * site honours this today because none of them had to change.
 *
 * **The preference lives on the PERSON now, not the device.** It used to be
 * `localStorage`, marked INTERIM with a precise expiry condition; B1 shipped
 * the columns and `PATCH /v1/me`, so the storage moved and the module kept its
 * shape, exactly as the marker promised. `localStorage` is GONE rather than
 * kept as a cache: a device copy beside a server copy is two sources for one
 * fact, and this codebase has spent a day on what two spellings of one fact do
 * to each other.
 *
 * **The in-memory store stays, and it is not a second source.** `formatDate` is
 * synchronous and runs during render, so it cannot await a fetch; this holds
 * the value the server last told us. It is a projection of the wire, written in
 * exactly two places — hydration on sign-in, and a successful save.
 */

/**
 * **Re-exported from core/, not re-typed.** B1 publishes
 * `CALENDAR_PREFERENCES` and its type; a hand-written copy here would be a
 * second union that agrees today and drifts the day a value is added — the
 * `Role`/`owner` shape exactly. There is no mirrored union to guard because
 * there is no mirror.
 */
export type CalendarPreference = CoreCalendarPreference;

/** `auto` = whatever the browser reports. Otherwise an IANA zone name. */
export type TimezonePreference = string;

const listeners = new Set<() => void>();

/*
 * Defaults before the person is known. `auto` is the honest value for "we have
 * not been told yet" AND the honest value for "they chose to follow the
 * language" — which is safe only because the two render identically. A
 * different placeholder would show one calendar and then swap to another.
 */
let calendar: CalendarPreference = "auto";
let timezone: TimezonePreference = TIMEZONE_AUTO;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Adopt what the server said. Called when identity loads, and the only other
 * writer besides a successful save.
 *
 * Validated rather than trusted: the values arrive over a wire, and a stored
 * value this client does not understand must fall back to `auto` rather than
 * reaching the formatter as a calendar nobody can render.
 */
export function hydratePreferences(me: Pick<Me, "calendar" | "timezone">): void {
  calendar = (CALENDAR_PREFERENCES as readonly string[]).includes(me.calendar)
    ? me.calendar
    : "auto";
  timezone = me.timezone || TIMEZONE_AUTO;
  emit();
}

export function getCalendarPreference(): CalendarPreference {
  return calendar;
}

export function getTimezonePreference(): TimezonePreference {
  return timezone;
}

/**
 * Save, THEN adopt — deliberately not optimistic.
 *
 * An optimistic update would redraw every date on the screen in a calendar the
 * server may reject (`calendar_unknown` / `timezone_unknown` are real refusals,
 * and the timezone is validated against what the runtime can actually render).
 * Showing the new calendar and then silently reverting is the UI claiming a
 * setting was saved when it was not — and these are settings people change
 * once, where a few hundred milliseconds cost nothing and a lie costs trust.
 *
 * Throws on refusal so the caller can say so. Swallowing it here would leave
 * the control looking like it worked, which is the failure this whole feature
 * was audited for once already.
 */
export async function saveCalendarPreference(next: CalendarPreference): Promise<void> {
  const me = await api.updatePreferences({ calendar: next });
  hydratePreferences(me);
}

export async function saveTimezonePreference(next: TimezonePreference): Promise<void> {
  const me = await api.updatePreferences({ timezone: next });
  hydratePreferences(me);
}

/**
 * The zone dates are actually rendered in. `auto` resolves to the browser's,
 * which is what every screen did before this existed — so `auto` is not a
 * special case in the formatter, just the resolved value.
 */
export function resolvedTimezone(): string {
  if (timezone !== TIMEZONE_AUTO) return timezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * The calendar dates are actually rendered in, given the active locale.
 * This is where "auto follows the language" is spelled out exactly once.
 */
export function resolvedCalendar(locale: string): "jalali" | "gregorian" {
  if (calendar !== "auto") return calendar;
  return locale === "fa" ? "jalali" : "gregorian";
}

/**
 * Subscribe to preference changes. Consumed by `usePreferences.ts`.
 *
 * The React half is a separate module for the same reason the theme's is:
 * `format.ts` imports this one, and `format.ts` must stay usable anywhere. A
 * hook here would make every module that formats a date client-only.
 */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: set the projection directly, without a round trip. */
export function __setPreferencesForTest(next: {
  calendar?: CalendarPreference;
  timezone?: TimezonePreference;
}): void {
  if (next.calendar !== undefined) calendar = next.calendar;
  if (next.timezone !== undefined) timezone = next.timezone;
  emit();
}
