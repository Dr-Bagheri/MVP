/**
 * The demo TIMELINE (M52) — every instant in a seeded organisation, derived
 * from one calendar day the operator picks.
 *
 * Pure, exported, and tested on fixed clocks, for the reason this repo keeps
 * re-learning: date arithmetic buried inside a seeding routine can only be
 * exercised by seeding, and a rule you can only test end to end is a rule
 * nobody tests at the edges. The edges here are real — a pricing call that
 * lands on the Iranian weekend, a pricing call that is itself a Tuesday, a
 * demo date that is not today.
 *
 * Zones are resolved through `Intl`, never through a hard-coded +03:30.
 * Iran dropped daylight saving in 2022 and the offset is stable today, but a
 * constant offset is a fact about this year written into code that will
 * outlive it — and the failure mode is a meeting an hour out, which reads as
 * a product bug rather than as a stale constant.
 */

export const DEMO_ZONE = "Asia/Tehran";

/** The pieces the engine needs. Every field is a UTC instant. */
export interface DemoTimeline {
  /** the day the whole timeline is measured from, as given */
  demoDate: string;
  /** the earlier full record — the weekly 1:1 */
  priorAt: Date;
  /** the pricing call, moved off the Iranian weekend if it landed there */
  pricingAt: Date;
  /** true when `pricingAt` was moved back to the Thursday */
  pricingMoved: boolean;
  /** the upcoming, unrecorded meeting that is "starting in N minutes" */
  upcomingAt: Date;
  /**
   * the presenter's one open card: the first Tuesday STRICTLY AFTER the
   * pricing call's day (as that day reads in Tehran), 13:00 UTC
   */
  quoteDueAt: Date;
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` into its parts, refusing anything that is not a day. */
export function parseDemoDate(value: string): { y: number; m: number; d: number } {
  const hit = DATE_SHAPE.exec(value.trim());
  if (hit === null) throw new RangeError("demo date must be YYYY-MM-DD");
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new RangeError("demo date is not a real day");
  }
  return { y, m, d };
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: DEMO_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far the zone is ahead of UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number): number {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(instant))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  return asIfUtc - instant;
}

/**
 * The UTC instant of a wall-clock time in DEMO_ZONE.
 *
 * Two passes, not one: the offset must be read at the instant we are
 * computing, and the first guess is off by exactly the offset. The second
 * read settles a transition (there is none in Tehran today; there was one
 * until 2022, and this is the arithmetic that stays right if one returns).
 */
export function zonedToUtc(
  y: number, m: number, d: number, hour: number, minute: number,
): Date {
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  const first = wall - zoneOffsetMs(wall);
  const second = wall - zoneOffsetMs(first);
  return new Date(second);
}

/** 0 = Sunday … 6 = Saturday, as the day reads IN Tehran. */
export function zoneWeekday(instant: Date): number {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant.getTime()));
  return local.getUTCDay();
}

const FRIDAY = 5;
const SATURDAY = 6;
const TUESDAY = 2;

/**
 * The pricing call: four days before the demo, at 14:00 Tehran — unless that
 * lands on the Iranian weekend, in which case it moves EARLIER to the
 * Thursday. Earlier and not later on purpose: the recording has to be in the
 * past on the demo day, and moving it forward could put it after the day
 * being demonstrated.
 */
function pricingDay(
  y: number, m: number, d: number, daysBefore: number, hour: number, minute: number,
): { at: Date; moved: boolean } {
  let back = daysBefore;
  let at = zonedToUtc(y, m, d - back, hour, minute);
  let moved = false;
  const day = zoneWeekday(at);
  if (day === FRIDAY || day === SATURDAY) {
    // Friday steps back one day, Saturday two — both land on the Thursday
    back += day === FRIDAY ? 1 : 2;
    at = zonedToUtc(y, m, d - back, hour, minute);
    moved = true;
  }
  return { at, moved };
}

/**
 * The first Tuesday STRICTLY AFTER the pricing call's day, at 13:00 UTC —
 * the deadline the pricing call promises out loud ("by Tuesday").
 *
 * Counted from the CALL, never from the demo date: the sentence is said on
 * the call, so the Tuesday it names is the next one from where the speaker
 * is standing. Counted from the DEMO DAY, on or after it (decided
 * 2026-09-09, after a cut that counted from the pricing call): the card is
 * the presenter's one open item and the demo's opening question is "what
 * should I do today" — a deadline that has already passed on the demo day
 * turns that answer into an apology. The recording's "by Tuesday" names the
 * same day whenever the demo runs on a Tuesday, and the next one otherwise.
 *
 * 13:00 UTC rather than a Tehran wall time because the card's deadline is
 * shown in every reader's own zone, and a round hour in UTC is the one
 * spelling that does not drift when the zone list changes.
 */
function firstTuesdayOnOrAfter(y: number, m: number, d: number): Date {
  const start = Date.UTC(y, m - 1, d, 13, 0, 0, 0);
  const weekday = new Date(start).getUTCDay();
  const ahead = (TUESDAY - weekday + 7) % 7;
  return new Date(start + ahead * 86_400_000);
}

/**
 * The upcoming, unrecorded meeting.
 *
 * TWO branches, and both are deliberate. Seeded FOR TODAY — the rehearsed
 * case, where the console is used minutes before somebody presents — the
 * meeting is `offset` minutes from NOW, because "starting in twenty minutes"
 * is the thing being demonstrated and a fixed hour would already be past by
 * the time the laptop is plugged in. Seeded for any other day, there is no
 * "now" to be relative to, so it is that day at 09:00 Tehran plus the offset:
 * deterministic, and still the first thing on the board that morning.
 */
function upcomingAt(
  y: number, m: number, d: number, offsetMinutes: number, now: Date,
): Date {
  const today = dayInZone(now);
  const same = today.y === y && today.m === m && today.d === d;
  const base = same
    ? new Date(Math.floor(now.getTime() / 60_000) * 60_000)
    : zonedToUtc(y, m, d, 9, 0);
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

/** The calendar day an instant falls on, in DEMO_ZONE. */
export function dayInZone(instant: Date): { y: number; m: number; d: number } {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant.getTime()));
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
  };
}

/** Today, in DEMO_ZONE, as the form's default. */
export function todayInZone(now: Date = new Date()): string {
  const { y, m, d } = dayInZone(now);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface TimelineInput {
  demoDate: string;
  offsetMinutes: number;
  /** the prior record's day offset and wall time, from the pack */
  prior: { daysBefore: number; hour: number; minute: number };
  pricing: { daysBefore: number; hour: number; minute: number };
  now?: Date;
}

export function buildTimeline(input: TimelineInput): DemoTimeline {
  const { y, m, d } = parseDemoDate(input.demoDate);
  const now = input.now ?? new Date();
  const priced = pricingDay(
    y, m, d, input.pricing.daysBefore, input.pricing.hour, input.pricing.minute,
  );
  return {
    demoDate: input.demoDate,
    priorAt: zonedToUtc(y, m, d - input.prior.daysBefore, input.prior.hour, input.prior.minute),
    pricingAt: priced.at,
    pricingMoved: priced.moved,
    upcomingAt: upcomingAt(y, m, d, input.offsetMinutes, now),
    quoteDueAt: firstTuesdayOnOrAfter(y, m, d),
  };
}

/**
 * An upcoming meeting a whole number of days after the demo day, at a Tehran
 * wall time — "tomorrow at ten". Not "now"-relative on purpose: the one
 * meeting that is relative to now is `upcomingAt`, and a second one would
 * make two meetings drift together as the clock runs.
 */
export function dayAfterAt(
  demoDate: string, daysAfter: number, hour: number, minute: number,
): Date {
  const { y, m, d } = parseDemoDate(demoDate);
  return zonedToUtc(y, m, d + daysAfter, hour, minute);
}

/**
 * A past instant a whole number of days BEFORE the demo day, at a Tehran wall
 * time — where a seeded conversation was opened.
 *
 * The twin of `dayAfterAt` rather than a call to it with a negative number:
 * "six days before" is what the pack says and what a reader checks, and
 * `dayAfterAt(demoDate, -6, ...)` is the same arithmetic wearing a name that
 * denies it. Both go through `zonedToUtc`, so a conversation and a meeting on
 * the same morning are the same morning.
 */
export function dayBeforeAt(
  demoDate: string, daysBefore: number, hour: number, minute: number,
): Date {
  const { y, m, d } = parseDemoDate(demoDate);
  return zonedToUtc(y, m, d - daysBefore, hour, minute);
}

/** A board card's deadline: whole days from the demo day, at 13:30 UTC. */
export function taskDueAt(demoDate: string, days: number): Date {
  const { y, m, d } = parseDemoDate(demoDate);
  return new Date(Date.UTC(y, m - 1, d + days, 13, 30, 0, 0));
}

/**
 * When a finished card was finished: spread backwards over the fortnight
 * before the demo, so "what did the team ship?" has a shape instead of
 * fifteen identical timestamps.
 */
export function doneAt(demoDate: string, index: number, total: number): Date {
  const { y, m, d } = parseDemoDate(demoDate);
  const back = 1 + Math.round(((total - 1 - index) * 13) / Math.max(total - 1, 1));
  return new Date(Date.UTC(y, m - 1, d - back, 12, 0, 0, 0));
}
