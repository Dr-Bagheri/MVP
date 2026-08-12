/** Persian digits + Jalali dates (M9). Display-time only — data stays ASCII. */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function faDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!);
}

/** Locale-aware: Persian digits only in fa. */
export function digits(input: string | number, locale: string): string {
  return locale === "fa" ? faDigits(input) : String(input);
}

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function div(a: number, b: number) {
  return Math.floor(a / b);
}

/** Gregorian → Jalali (standard 33-year cycle arithmetic, no dependency). */
export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
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

/** «۱۹ مرداد ۱۴۰۵» in fa; a plain locale date in en. */
export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (locale !== "fa") {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const { jy, jm, jd } = toJalali(date);
  return `${faDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`;
}

export function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return digits(`${hh}:${mm}`, locale);
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
