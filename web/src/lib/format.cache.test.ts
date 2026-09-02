import { beforeEach, describe, expect, it, vi } from "vitest";

/* preferences.ts imports the client for its save path; nothing here saves */
const updatePreferences = vi.fn();
vi.mock("@/api/client", () => ({ api: { updatePreferences: () => updatePreferences() } }));

const { digits, formatDate, formatTime, formatRelativeDate } = await import("./format");
const { __setPreferencesForTest, getTimezonePreference } = await import("./preferences");

/**
 * **The formatter cache changes nothing about what a date says.**
 *
 * `format.ts` used to build a new `Intl.DateTimeFormat` for every rendered
 * date — two in `partsIn`'s branches and a third for the Gregorian month name
 * — and `preferences.ts` built a fourth inside `resolvedTimezone()`'s auto
 * path. All four are now cached. A cache is exactly the kind of change that
 * can be right on the screen you looked at and wrong on the one you did not,
 * so this file compares the cached output to a FRESHLY CONSTRUCTED formatter
 * across the whole matrix: fa and en, Jalali and Gregorian, an explicit zone
 * and the browser's.
 *
 * The reference below is the pre-cache implementation, transcribed — it builds
 * its formatter on every call, which is the property being compared against.
 * It deliberately does NOT call `resolvedTimezone()`: the point is to resolve
 * the zone the old way and see the same answer, and a reference that borrowed
 * the implementation's cache could not tell you that.
 *
 * The Jalali branch cannot be reconstructed without duplicating the 33-year
 * cycle arithmetic (which this change does not touch, and which duplicating
 * would only test against itself), so it is pinned against dates whose Jalali
 * value is known independently of this module.
 *
 * Verified red: keying the cache on locale alone — dropping `timeZone` from
 * the key, the one mistake a formatter cache actually makes — fails four of
 * these with a wrong hour and a date off by a day.
 */

/** the zone as `resolvedTimezone()` resolved it BEFORE the cache existed */
function referenceZone(): string {
  const preference = getTimezonePreference();
  if (preference !== "auto") return preference;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** `partsIn`, as it stood before the cache: a new formatter every call */
function referenceParts(date: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** `formatDate`'s Gregorian branch, uncached */
function referenceGregorianDate(iso: string, locale: string): string {
  const { y, m, d } = referenceParts(new Date(iso), referenceZone());
  const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return `⁨${digits(d, locale)} ${month} ${digits(y, locale)}⁩`;
}

/** `formatTime`, uncached */
function referenceTime(iso: string, locale: string): string {
  const { hh, mm } = referenceParts(new Date(iso), referenceZone());
  const pad = (n: number) => String(n).padStart(2, "0");
  return digits(`${pad(hh)}:${pad(mm)}`, locale);
}

/*
 * Instants chosen to make a wrong zone VISIBLE rather than merely possible:
 * each of the first three sits close enough to midnight that Tehran, New York
 * and UTC disagree about the calendar day, and the last is inside US daylight
 * saving so a zone that resolves without DST lands an hour off.
 */
const INSTANTS = [
  "2026-06-14T09:00:00Z",
  "2026-06-14T22:30:00Z",
  "2026-01-01T20:15:00Z",
  "2026-03-15T06:45:00Z",
];

const ZONES = ["auto", "UTC", "Asia/Tehran", "America/New_York"] as const;
const LOCALES = ["fa", "en"] as const;

describe("the Intl formatter cache is invisible in the output", () => {
  beforeEach(() => {
    __setPreferencesForTest({ calendar: "auto", timezone: "auto" });
  });

  it("Gregorian dates are byte-identical to a freshly built formatter", () => {
    let compared = 0;
    for (const timezone of ZONES) {
      for (const locale of LOCALES) {
        /* explicit gregorian so BOTH locales take this branch — in fa this is
           the override case, which is the one a locale-only cache would miss */
        __setPreferencesForTest({ calendar: "gregorian", timezone });
        for (const iso of INSTANTS) {
          expect(formatDate(iso, locale)).toBe(referenceGregorianDate(iso, locale));
          compared += 1;
        }
      }
    }
    /* the had-something-to-check assertion: a matrix that silently shrank to
       zero would otherwise pass by comparing nothing */
    expect(compared).toBe(ZONES.length * LOCALES.length * INSTANTS.length);
  });

  it("times are byte-identical to a freshly built formatter", () => {
    let compared = 0;
    for (const timezone of ZONES) {
      for (const locale of LOCALES) {
        __setPreferencesForTest({ calendar: "auto", timezone });
        for (const iso of INSTANTS) {
          expect(formatTime(iso, locale)).toBe(referenceTime(iso, locale));
          compared += 1;
        }
      }
    }
    expect(compared).toBe(ZONES.length * LOCALES.length * INSTANTS.length);
  });

  /*
   * The Jalali branch reads the SAME (y, m, d) the two cases above prove
   * identical, then runs arithmetic this change does not touch. Pinned anyway,
   * because "it follows" is reasoning and this is a check — and pinned against
   * values whose Jalali equivalent is known outside this module.
   */
  it("Jalali dates hold their known values in both zones and both locales", () => {
    __setPreferencesForTest({ calendar: "jalali", timezone: "UTC" });
    expect(formatDate("2026-06-14T09:00:00Z", "fa")).toBe("⁨۲۴ خرداد ۱۴۰۵⁩");
    /* English is Gregorian whatever is stored (2026-09-02) — the cache is
       keyed on the RESOLVED calendar, so this is also the assertion that a
       shared cache does not leak one locale's answer into the other */
    expect(formatDate("2026-06-14T09:00:00Z", "en")).toBe("⁨14 Jun 2026⁩");
    expect(formatDate("2026-01-01T20:15:00Z", "fa")).toBe("⁨۱۱ دی ۱۴۰۴⁩");

    /* 22:30 UTC is already the next day in Tehran (+03:30) — the case a cache
       keyed without the zone gets wrong while every UTC assertion stays green */
    __setPreferencesForTest({ calendar: "jalali", timezone: "Asia/Tehran" });
    expect(formatDate("2026-06-14T22:30:00Z", "fa")).toBe("⁨۲۵ خرداد ۱۴۰۵⁩");
    __setPreferencesForTest({ calendar: "jalali", timezone: "UTC" });
    expect(formatDate("2026-06-14T22:30:00Z", "fa")).toBe("⁨۲۴ خرداد ۱۴۰۵⁩");
  });

  it("a warm cache answers the same as a cold one, call after call", () => {
    for (const timezone of ZONES) {
      for (const calendar of ["auto", "jalali", "gregorian"] as const) {
        for (const locale of LOCALES) {
          __setPreferencesForTest({ calendar, timezone });
          const first = formatDate(INSTANTS[0]!, locale);
          const tenth = Array.from({ length: 10 }, () => formatDate(INSTANTS[0]!, locale)).at(-1);
          expect(tenth).toBe(first);
        }
      }
    }
  });

  it("relative dates older than a week fall through to the same formatted date", () => {
    __setPreferencesForTest({ calendar: "gregorian", timezone: "UTC" });
    const old = "2020-02-29T12:00:00Z";
    expect(formatRelativeDate(old, "en")).toBe(formatDate(old, "en"));
    expect(formatRelativeDate(old, "en")).toBe(referenceGregorianDate(old, "en"));
  });

  /*
   * `resolvedTimezone()` caches the browser's zone; an explicit choice must
   * still win, and switching back to auto must not serve the explicit one.
   */
  it("switching between an explicit zone and auto re-resolves", () => {
    __setPreferencesForTest({ calendar: "gregorian", timezone: "auto" });
    const auto = formatTime("2026-06-14T22:30:00Z", "en");
    __setPreferencesForTest({ timezone: "Asia/Tehran" });
    expect(formatTime("2026-06-14T22:30:00Z", "en")).toBe("02:00");
    __setPreferencesForTest({ timezone: "auto" });
    expect(formatTime("2026-06-14T22:30:00Z", "en")).toBe(auto);
    expect(formatTime("2026-06-14T22:30:00Z", "en")).toBe(referenceTime("2026-06-14T22:30:00Z", "en"));
  });
});
