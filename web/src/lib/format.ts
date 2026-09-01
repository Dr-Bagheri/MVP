/** Persian digits + Jalali dates (M9). Display-time only — data stays ASCII. */

import { resolvedCalendar, resolvedTimezone } from "./preferences";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Normalize Persian (U+06F0–９) and Arabic-Indic (U+0660–９) digits to ASCII —
 * the INPUT side of the digits story: a numeric field that strips what the
 * standard Persian keyboard types is a field Persian users cannot type in.
 */
export function asciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

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
  const display = name.replace(/^[^:]+:\s*/, "");
  /* Provider catalogue suffixes describe availability tiers, not the model
     names we present in NeurAI. Keep the provider id unchanged for routing;
     this is deliberately display-only. */
  if (display === "Gemini 3.1 Pro Preview") return "Gemini 3.1 Pro";
  if (display === "Gemini 3.1 Flash Lite") return "Gemini 3.1 Flash";
  return display;
}

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function div(a: number, b: number) {
  return Math.floor(a / b);
}

/**
 * One `Intl.DateTimeFormat` per distinct (locale, options) pair, for the life
 * of the page.
 *
 * Constructing a formatter is the expensive part of `Intl` — locale
 * negotiation and pattern resolution — and formatting with an existing one is
 * cheap. This module was building a new one on EVERY rendered date (two in
 * `partsIn`'s two branches, a third for the Gregorian month name), so a
 * ten-row table cost about thirty constructions per render, and the tables
 * that show dates re-render on every keystroke of their search boxes.
 *
 * The key is derived from the options object itself rather than hand-written
 * beside each call site: a second spelling of the same option set is exactly
 * the drift this codebase keeps finding, and `JSON.stringify` on a
 * six-property literal is roughly two orders of magnitude cheaper than the
 * constructor it replaces. Two call sites listing the same options in a
 * different order simply get two entries — both correct.
 *
 * The map is unbounded by construction, and bounded in practice by what a
 * page can ask for: the option sets are three literals and the only variable
 * is the viewer's timezone, which is one value (two if they change it).
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale} ${JSON.stringify(options)}`;
  const hit = formatterCache.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(locale, options);
  formatterCache.set(key, made);
  return made;
}

/** the shape `partsIn` reads, named once so both branches cannot drift apart */
const PARTS_OPTIONS = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
} as const satisfies Intl.DateTimeFormatOptions;

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
    parts = dateFormatter("en-US", { timeZone, ...PARTS_OPTIONS }).formatToParts(date);
  } catch {
    // an invalid stored zone must not blank every date on the screen
    parts = dateFormatter("en-US", { ...PARTS_OPTIONS }).formatToParts(date);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
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
    const month = dateFormatter("en-GB", { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
    return bidiIsolate(`${digits(d, locale)} ${month} ${digits(y, locale)}`);
  }
  const { y, m, d } = partsIn(date, zone);
  const { jy, jm, jd } = jalaliFromParts(y, m, d);
  return bidiIsolate(`${digits(jd, locale)} ${JALALI_MONTHS[jm - 1]} ${digits(jy, locale)}`);
}

/**
 * Relative rendering for TABLE dates (2026-08-24 cleanup #3): «امروز»,
 * «دیروز», «N روز پیش» up to a week, then the full formatDate. Day
 * boundaries are computed in the viewer's resolved timezone — a call at
 * 23:50 is «دیروز» the moment midnight passes, not 10 minutes later.
 * Callers put the exact formatDate in the title attribute.
 */
export function formatRelativeDate(iso: string, locale: string): string {
  const zone = resolvedTimezone();
  const day = (d: Date) => {
    const { y, m, d: dd } = partsIn(d, zone);
    return Date.UTC(y, m - 1, dd);
  };
  const diff = Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000);
  if (diff <= 0) return locale === "fa" ? "امروز" : "Today";
  if (diff === 1) return locale === "fa" ? "دیروز" : "Yesterday";
  if (diff < 7) {
    return locale === "fa" ? `${faDigits(diff)} روز پیش` : `${diff} days ago`;
  }
  return formatDate(iso, locale);
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
  /*
   * Under a minute, minutes lie in both directions: a 13-second test call
   * rendered "0 min" — a number that reads as "no recording" on a call that
   * plainly has one (user report, 2026-08-20). Seconds are the honest unit
   * until a full minute exists.
   */
  if (totalSeconds < 60) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (locale !== "fa") return `${seconds} s`;
    return `${faDigits(seconds)} ثانیه`;
  }
  const minutes = Math.round(totalSeconds / 60);
  if (locale !== "fa") return `${minutes} min`;
  return `${faDigits(minutes)} دقیقه`;
}

/** Days remaining in the 30-day purge window (M11). */
export function purgeDaysLeft(deletedAtIso: string): number {
  const elapsed = Date.now() - new Date(deletedAtIso).getTime();
  return Math.max(0, 30 - Math.floor(elapsed / 86_400_000));
}

/* ── the month grid ────────────────────────────────────────────────────────
 *
 * A real calendar (user directive, 2026-08-29: "the calender must show the
 * real calender with dates and everything in squar shape if it get any
 * related information from the user it will show in that date") needs three
 * things this module already knows and no component should re-derive: which
 * calendar the viewer reads, which timezone their days are cut in, and how a
 * Jalali month maps onto Gregorian days.
 *
 * The grid is built by WALKING DAYS rather than by inverting the Jalali
 * conversion. Inverting it would be a second implementation of the same
 * arithmetic — the two spellings that drift — while walking uses the one
 * conversion that every date on screen already goes through, so a month grid
 * and a formatted date can never disagree about what day it is.
 */

const DAY_MS = 86_400_000;

/**
 * The day an instant falls on, as the UTC midnight of that calendar day in
 * the viewer's own zone. It is a KEY, not a time: two instants get the same
 * number exactly when a person would call them the same day.
 */
export function dayKeyOf(iso: string | Date): number {
  const { y, m, d } = partsIn(typeof iso === "string" ? new Date(iso) : iso, resolvedTimezone());
  return Date.UTC(y, m - 1, d);
}

/** the active calendar's (year, month, day) for a day key */
function activeParts(key: number, locale: string): { y: number; m: number; d: number } {
  const date = new Date(key);
  const gy = date.getUTCFullYear();
  const gm = date.getUTCMonth() + 1;
  const gd = date.getUTCDate();
  if (resolvedCalendar(locale) === "gregorian") return { y: gy, m: gm, d: gd };
  const { jy, jm, jd } = jalaliFromParts(gy, gm, gd);
  return { y: jy, m: jm, d: jd };
}

export interface MonthCell {
  /** the day key this square stands for — matches `dayKeyOf` on an event */
  key: number;
  /** the day number, in the reader's digits */
  label: string;
  /** a day of the month being shown, rather than the padding either side */
  inMonth: boolean;
  today: boolean;
}

export interface MonthGrid {
  /** «شهریور ۱۴۰۵» / "August 2026" */
  title: string;
  /** seven short weekday names, starting at this calendar's first day */
  weekdays: string[];
  /** whole weeks, so the grid is always rectangular */
  cells: MonthCell[];
}

const JALALI_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const GREGORIAN_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/* the week strip wants the FULL short names (user directive, 2026-09-01:
   "use the full small name for days of the week") — the month grid keeps
   its single letters, where seven columns share a phone's width */
const JALALI_WEEKDAYS_FULL = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const GREGORIAN_WEEKDAYS_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The month `now` falls in, as whole weeks of squares.
 *
 * The week starts on SATURDAY under the Jalali calendar and on Sunday under
 * the Gregorian one — a Persian calendar whose first column is Sunday is
 * wrong in the way that makes every date in it land one column off.
 */
export function monthGrid(now: Date, locale: string): MonthGrid {
  const jalali = resolvedCalendar(locale) !== "gregorian";
  const todayKey = dayKeyOf(now);
  const { m: month, y: year, d: dayOfMonth } = activeParts(todayKey, locale);

  /* the month's first day, reached by stepping back — the same walk the rest
     of this function makes, rather than a second way of finding it */
  const firstKey = todayKey - (dayOfMonth - 1) * DAY_MS;

  /* how many leading squares belong to the previous month: the weekday of
     the first, counted from this calendar's own first day */
  const weekdayOfFirst = new Date(firstKey).getUTCDay();          // 0 = Sunday
  const lead = jalali ? (weekdayOfFirst + 1) % 7 : weekdayOfFirst; // Saturday-first
  const cells: MonthCell[] = [];

  for (let i = 0; ; i += 1) {
    const key = firstKey + (i - lead) * DAY_MS;
    const parts = activeParts(key, locale);
    const inMonth = parts.m === month && parts.y === year;
    /* stop at the end of the week the month ends in — a grid that stopped on
       the last day would leave a ragged final row */
    if (!inMonth && i > lead && cells.length % 7 === 0) break;
    cells.push({
      key,
      label: digits(parts.d, locale),
      inMonth,
      today: key === todayKey,
    });
  }

  const monthName = jalali
    ? JALALI_MONTHS[month - 1]!
    : dateFormatter("en-GB", { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, 1)));

  return {
    title: `${monthName} ${digits(year, locale)}`,
    weekdays: jalali ? JALALI_WEEKDAYS : GREGORIAN_WEEKDAYS,
    cells,
  };
}

export interface WeekCell {
  /** the day key — matches `dayKeyOf` on an event */
  key: number;
  /** short weekday name («ش» / "S") */
  weekday: string;
  /** day-of-month, in the reader's digits */
  label: string;
  today: boolean;
  /** the rest day, tinted apart on the strip: Friday under the Jalali
      calendar, Saturday+Sunday under the Gregorian one */
  weekend: boolean;
}

/**
 * The week `now` falls in, as seven day cells — the dashboard's week strip
 * (0144-era reference adoption). Same week-start law as `monthGrid`:
 * Saturday-first under Jalali, Sunday-first under Gregorian — and derived
 * by the same walk, so the two can never disagree about which column a
 * date lands in.
 */
export function weekStrip(now: Date, locale: string, offsetWeeks = 0): WeekCell[] {
  const jalali = resolvedCalendar(locale) !== "gregorian";
  const todayKey = dayKeyOf(now);
  const weekdayOfToday = new Date(todayKey).getUTCDay();          // 0 = Sunday
  const lead = jalali ? (weekdayOfToday + 1) % 7 : weekdayOfToday; // Saturday-first
  const names = jalali ? JALALI_WEEKDAYS_FULL : GREGORIAN_WEEKDAYS_FULL;
  const cells: WeekCell[] = [];
  for (let i = 0; i < 7; i += 1) {
    const key = todayKey + (i - lead + offsetWeeks * 7) * DAY_MS;
    const utcDay = new Date(key).getUTCDay();
    cells.push({
      key,
      weekday: names[i]!,
      label: digits(activeParts(key, locale).d, locale),
      today: key === todayKey,
      weekend: jalali ? utcDay === 5 : utcDay === 0 || utcDay === 6,
    });
  }
  return cells;
}

/**
 * «۷ تا ۱۳ شهریور ۱۴۰۵» / "Sep 7 – 13, 2026" — the strip's own range, from
 * its first and last cells; crossing a month boundary names both months.
 */
export function weekRangeLabel(cells: WeekCell[], locale: string): string {
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (!first || !last) return "";
  const jalali = resolvedCalendar(locale) !== "gregorian";
  const a = activeParts(first.key, locale);
  const b = activeParts(last.key, locale);
  const monthName = (m: number, y: number) => jalali
    ? JALALI_MONTHS[m - 1]!
    : dateFormatter("en-GB", { month: "short", timeZone: "UTC" })
        .format(new Date(Date.UTC(y, m - 1, 1)));
  /* digits follow the LANGUAGE even when the calendar is Gregorian (the
     avatar-menu axes ruling): a fa reader on the Gregorian calendar reads
     Persian digits around a Latin month name */
  if (a.m === b.m && a.y === b.y) {
    return jalali
      ? `${digits(a.d, locale)} تا ${digits(b.d, locale)} ${monthName(a.m, a.y)} ${digits(a.y, locale)}`
      : `${monthName(a.m, a.y)} ${digits(a.d, locale)} – ${digits(b.d, locale)}, ${digits(a.y, locale)}`;
  }
  return jalali
    ? `${digits(a.d, locale)} ${monthName(a.m, a.y)} تا ${digits(b.d, locale)} ${monthName(b.m, b.y)} ${digits(b.y, locale)}`
    : `${monthName(a.m, a.y)} ${digits(a.d, locale)} – ${monthName(b.m, b.y)} ${digits(b.d, locale)}, ${digits(b.y, locale)}`;
}
