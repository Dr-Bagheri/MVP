/** Persian digits + Jalali dates (M9). Display-time only — data stays ASCII. */

import { resolvedCalendar, resolvedTimezone } from "./preferences";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function faDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!);
}

/** Locale-aware: Persian digits only in fa. */
export function digits(input: string | number, locale: string): string {
  return locale === "fa" ? faDigits(input) : String(input);
}

/**
 * A person's name for the ACTIVE locale: `display_name_en` in English where
 * one exists, otherwise `display_name` EXACTLY AS AUTHORED, both locales.
 *
 * **Names are never transliterated, translated or respelled** (user verdict,
 * 2026-08-16 evening). A dictionary-and-letter-map version shipped for a few
 * hours and rendered the user's own name as an unreadable «دربقری» — the
 * letter map cannot know the vowels Persian script omits, and a wrong
 * spelling of someone's NAME is worse than a foreign-script one. The verdict
 * closes the question: a name renders in whatever script its owner typed,
 * and a Latin name in the Persian UI is correct, not a gap.
 *
 * Shared rather than per-surface on purpose. Name resolution is one rule, and
 * two implementations of one rule is the drift shape this codebase keeps
 * finding — the English shell would say "Sara" while an English table two
 * screens away said «سارا محمدی», and both would look correct alone.
 */
export function personName(
  person: { display_name: string; display_name_en?: string | null } | null | undefined,
  locale: string,
): string {
  if (!person) return "";
  if (locale === "fa") return person.display_name;
  const en = person.display_name_en?.trim();
  return en && en.length > 0 ? en : person.display_name;
}

/**
 * A model's DISPLAY name: the catalogue's "Provider: Model" with the
 * provider half dropped (user directive — "Google: Gemini 3.1" reads as
 * noise; the model IS the name). The id keeps the provider for anything
 * that routes; this is display only, one rule for every picker.
 */
export function modelLabel(name: string): string {
  return name.replace(/^[^:]+:\s*/, "");
}

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function div(a: number, b: number) {
  return Math.floor(a / b);
}

/**
 * The calendar/clock parts of an instant IN A GIVEN ZONE.
 *
 * Every date on screen used to be extracted with `getFullYear()` and friends,
 * which read the BROWSER's zone. That is right until someone sets a timezone
 * preference, at which point it is silently wrong by up to a day — and "wrong
 * by a day" on a meeting list is the failure the Jalali work already guarded
 * against from the other direction.
 */
function partsIn(date: Date, timeZone: string): {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
} {
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
    // an invalid stored zone must not blank every date on the screen
    parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** Gregorian → Jalali (standard 33-year cycle arithmetic, no dependency). */
export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const { y: gy, m: gm, d: gd } = partsIn(date, resolvedTimezone());
  return jalaliFromParts(gy, gm, gd);
}

function jalaliFromParts(gy: number, gm: number, gd: number): {
  jy: number;
  jm: number;
  jd: number;
} {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    g_d_m[gm - 1]!;
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

/**
 * «۱۹ مرداد ۱۴۰۵» in fa; a plain locale date in en — unless the person has
 * chosen a calendar explicitly, in which case that wins.
 *
 * The preference is read here rather than passed in: an argument every caller
 * has to remember is a setting that quietly does nothing wherever someone
 * forgot. Digits still follow the LOCALE, not the calendar — a Gregorian date
 * in a Persian UI reads «۱۴ Jun ۲۰۲۶», because the digits belong to the
 * language and the months to the calendar.
 */
/**
 * FIRST-STRONG ISOLATE (U+2068 … U+2069) around every formatted date.
 *
 * The fix for the year standing on the wrong side (user report, 2026-08-18:
 * the English top bar read «27 1405 مرداد»). A Jalali date in an LTR
 * paragraph is a Persian month between two runs of digits, and the bidi
 * algorithm reorders exactly that shape; a Gregorian date in the Persian UI
 * is the same trap mirrored. The isolate makes the date its own little
 * paragraph whose direction comes from its own first strong character —
 * the month — so «۲۷ مرداد ۱۴۰۵» and "18 Aug 2026" each hold their order
 * in EITHER surrounding direction, with no per-consumer <bdi> to forget.
 */
const bidiIsolate = (formatted: string) => `⁨${formatted}⁩`;

export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  const zone = resolvedTimezone();
  if (resolvedCalendar(locale) === "gregorian") {
    const { y, m, d } = partsIn(date, zone);
    const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
    return bidiIsolate(`${digits(d, locale)} ${month} ${digits(y, locale)}`);
  }
  const { y, m, d } = partsIn(date, zone);
  const { jy, jm, jd } = jalaliFromParts(y, m, d);
  return bidiIsolate(`${digits(jd, locale)} ${JALALI_MONTHS[jm - 1]} ${digits(jy, locale)}`);
}

export function formatTime(iso: string, locale: string): string {
  const { hh, mm } = partsIn(new Date(iso), resolvedTimezone());
  const pad = (n: number) => String(n).padStart(2, "0");
  return digits(`${pad(hh)}:${pad(mm)}`, locale);
}

/** Clock for players and timestamps: m:ss / h:mm:ss. */
export function formatClock(totalSeconds: number, locale = "fa"): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const core = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  return digits(core, locale);
}

export function formatDuration(totalSeconds: number, locale: string): string {
  const minutes = Math.round(totalSeconds / 60);
  if (locale !== "fa") return `${minutes} min`;
  return `${faDigits(minutes)} دقیقه`;
}

/** Days remaining in the 30-day purge window (M11). */
export function purgeDaysLeft(deletedAtIso: string): number {
  const elapsed = Date.now() - new Date(deletedAtIso).getTime();
  return Math.max(0, 30 - Math.floor(elapsed / 86_400_000));
}
