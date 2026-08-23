/**
 * Persian date-expression resolution (the moat lane's foundation,
 * 2026-08-23): «قرار شد تا سه‌شنبهٔ هفتهٔ آینده آماده شود» carries a real
 * deadline, and every Western tool drops it. This module turns Persian
 * RELATIVE expressions (فردا، پس‌فردا، سه‌شنبه، دو روز دیگر، هفتهٔ آینده)
 * and ABSOLUTE Jalali dates («۱۵ شهریور»، «اول مهر») into concrete
 * Jalali + Gregorian dates, given the reference moment (the call's date —
 * a commitment is relative to when it was SPOKEN, never to when it is
 * read).
 *
 * Dependency-free: Gregorian→Jalali comes from Intl's own Persian
 * calendar; Jalali→Gregorian is an estimate refined against that same
 * Intl conversion, so the two directions can never disagree with each
 * other (one authority, not two implementations).
 *
 * Matching discipline (the «دی» inside «محمدی» lesson): every pattern is
 * anchored on Persian letter boundaries — a month name may not begin or
 * end inside a longer word.
 */

export interface ResolvedDate {
  /** the exact text that matched */
  match: string;
  /** character offset of the match in the input */
  index: number;
  jalali: { jy: number; jm: number; jd: number };
  /** YYYY-MM-DD (Gregorian, local) */
  gregorian: string;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

/** ZWNJ and plain-space spelling variants collapse to one form. */
function normalize(s: string): string {
  return s.replace(/‌/g, "‌"); // keep ZWNJ; patterns allow both
}

const MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** JS getDay() index for each Persian weekday name. */
const WEEKDAYS: [string, number][] = [
  ["شنبه", 6], ["یکشنبه", 0], ["یک‌شنبه", 0], ["دوشنبه", 1], ["دو‌شنبه", 1],
  ["سه‌شنبه", 2], ["سه شنبه", 2], ["چهارشنبه", 3], ["چهار‌شنبه", 3],
  ["پنجشنبه", 4], ["پنج‌شنبه", 4], ["جمعه", 5],
];

const NUMBER_WORDS: Record<string, number> = {
  "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5,
  "شش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10,
};

const ORDINAL_DAYS: Record<string, number> = {
  "اول": 1, "یکم": 1, "دوم": 2, "سوم": 3, "چهارم": 4, "پنجم": 5,
  "ششم": 6, "هفتم": 7, "هشتم": 8, "نهم": 9, "دهم": 10,
  "یازدهم": 11, "دوازدهم": 12, "سیزدهم": 13, "چهاردهم": 14, "پانزدهم": 15,
  "شانزدهم": 16, "هفدهم": 17, "هجدهم": 18, "نوزدهم": 19, "بیستم": 20,
  "سی‌ام": 30, "سیام": 30,
};

/** Gregorian date → Jalali parts, via Intl's Persian calendar. */
export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { jy: get("year"), jm: get("month"), jd: get("day") };
}

const DAY_MS = 86_400_000;
function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}

/**
 * Jalali → Gregorian: estimate (Farvardin 1 ≈ March 21 of jy+621, plus the
 * fixed month lengths), then walk the estimate until Intl agrees. The walk
 * is bounded — leap-year drift is at most two days.
 */
export function fromJalali(jy: number, jm: number, jd: number): Date | null {
  const daysInto =
    (jm <= 6 ? (jm - 1) * 31 : 6 * 31 + (jm - 7) * 30) + (jd - 1);
  let g = new Date(jy + 621, 2, 21, 12);
  g = new Date(g.getTime() + daysInto * DAY_MS);
  for (let i = 0; i < 8; i += 1) {
    const j = toJalali(g);
    if (j.jy === jy && j.jm === jm && j.jd === jd) return g;
    const diff =
      (jy - j.jy) * 365 + (jm - j.jm) * 30 + (jd - j.jd);
    g = new Date(g.getTime() + (diff === 0 ? 1 : diff) * DAY_MS);
  }
  return null; // an impossible date («۳۲ شهریور») resolves to nothing
}

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolved(match: string, index: number, date: Date): ResolvedDate {
  return { match, index, jalali: toJalali(date), gregorian: iso(date) };
}

/** letter boundary: not preceded/followed by a Persian letter or ZWNJ */
const B_BEFORE = "(?<![\\u0600-\\u06FF\\u200c])";
const B_AFTER = "(?![\\u0600-\\u06FF\\u200c])";

export function extractPersianDates(rawText: string, ref: Date): ResolvedDate[] {
  const text = normalize(rawText);
  const base = atNoon(ref);
  const out: ResolvedDate[] = [];
  const claimed: [number, number][] = [];
  const free = (i: number, len: number) =>
    !claimed.some(([s, e]) => i < e && i + len > s);
  const claim = (i: number, len: number) => claimed.push([i, i + len]);
  const addAll = (re: RegExp, toDate: (m: RegExpExecArray) => Date | null) => {
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      if (!free(i, m[0].length)) continue;
      const d = toDate(m as RegExpExecArray);
      if (d) {
        claim(i, m[0].length);
        out.push(resolved(m[0], i, d));
      }
    }
  };

  // ── absolute Jalali dates first (most specific wins the overlap) ─────────
  const monthAlt = MONTHS.join("|");
  const ordinalAlt = Object.keys(ORDINAL_DAYS).join("|");
  addAll(
    new RegExp(
      `${B_BEFORE}(?:(\\d{1,2}|[۰-۹]{1,2})|(${ordinalAlt}))[\\s\\u200c]*(?:ام)?[\\s\\u200c]+(${monthAlt})${B_AFTER}(?:[\\s\\u200c]+(\\d{4}|[۰-۹]{4}))?`,
      "gu",
    ),
    (m) => {
      const jd = m[1] ? Number(toLatinDigits(m[1])) : ORDINAL_DAYS[m[2]!]!;
      const jm = MONTHS.indexOf(m[3]!) + 1;
      if (jd < 1 || jd > 31) return null;
      const jy = m[4] ? Number(toLatinDigits(m[4])) : undefined;
      if (jy) return fromJalali(jy, jm, jd);
      // no year spoken: the NEXT occurrence on or after the reference
      const refJ = toJalali(base);
      const thisYear = fromJalali(refJ.jy, jm, jd);
      if (thisYear && thisYear.getTime() >= base.getTime() - DAY_MS / 2) return thisYear;
      return fromJalali(refJ.jy + 1, jm, jd);
    },
  );

  // ── weekday, with «هفتهٔ بعد/آینده» reaching into NEXT week ──────────────
  const weekdayAlt = WEEKDAYS.map(([w]) => w).join("|");
  addAll(
    new RegExp(
      `${B_BEFORE}(${weekdayAlt})(?:[\\u0629\\u0647\\u06c0\\u0654\\u200c\\u06cc\\s]{0,3}(هفته[\\s\\u200c]*(?:ی|ٔ)?[\\s\\u200c]*(?:بعد|آینده|دیگر)))?${B_AFTER}`,
      "gu",
    ),
    (m) => {
      const target = WEEKDAYS.find(([w]) => w === m[1])![1];
      const refDay = base.getDay();
      if (m[2]) {
        // the weekday of NEXT WEEK: to the coming شنبه, then within it
        const toSaturday = ((6 - refDay + 7) % 7) || 7;
        const within = (target - 6 + 7) % 7;
        return new Date(base.getTime() + (toSaturday + within) * DAY_MS);
      }
      const days = ((target - refDay + 7) % 7) || 7; // bare name = the next one
      return new Date(base.getTime() + days * DAY_MS);
    },
  );

  // ── relative words ───────────────────────────────────────────────────────
  addAll(new RegExp(`${B_BEFORE}پس[\\s\\u200c]*فردا${B_AFTER}`, "gu"),
    () => new Date(base.getTime() + 2 * DAY_MS));
  addAll(new RegExp(`${B_BEFORE}فردا${B_AFTER}`, "gu"),
    () => new Date(base.getTime() + DAY_MS));
  addAll(new RegExp(`${B_BEFORE}امروز${B_AFTER}`, "gu"), () => base);

  // «N روز/هفته/ماه دیگر» — number word or digits
  const numAlt = Object.keys(NUMBER_WORDS).join("|");
  addAll(
    new RegExp(
      `${B_BEFORE}(\\d{1,2}|[۰-۹]{1,2}|${numAlt})[\\s\\u200c]+(روز|هفته|ماه)[\\s\\u200c]+(دیگر|بعد)${B_AFTER}`,
      "gu",
    ),
    (m) => {
      const n = NUMBER_WORDS[m[1]!] ?? Number(toLatinDigits(m[1]!));
      if (!Number.isFinite(n) || n < 1 || n > 90) return null;
      const unit = m[2] === "روز" ? 1 : m[2] === "هفته" ? 7 : 30;
      return new Date(base.getTime() + n * unit * DAY_MS);
    },
  );

  // «هفتهٔ بعد/آینده» standing alone = one week out
  addAll(
    new RegExp(`${B_BEFORE}هفته[\\s\\u200c]*(?:ی|ٔ)?[\\s\\u200c]*(?:بعد|آینده)${B_AFTER}`, "gu"),
    () => new Date(base.getTime() + 7 * DAY_MS),
  );

  return out.sort((a, b) => a.index - b.index);
}
