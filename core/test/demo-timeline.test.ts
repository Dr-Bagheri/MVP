/**
 * The demo timeline's arithmetic (M52).
 *
 * Two kinds of assertion on purpose. The PINNED instants catch an off-by-one
 * — a day early, an hour out, a zone applied twice — and they are computed by
 * hand from the calendar rather than from a first run of the code, because a
 * fixture read off the implementation agrees with the implementation by
 * construction. The PROPERTY assertions catch the rule being right for the
 * wrong reason: the pricing call is never on the Iranian weekend, the
 * deadline is always a Tuesday, and both are true for every day of a year
 * rather than for the three days somebody thought of.
 *
 * The calendar facts these lean on, stated so a reader can check them without
 * running anything: 1 January 2026 is a Thursday, so 1 September 2026 is a
 * Tuesday, 3 September is a Thursday, 5 September is a Saturday, 8 September
 * is a Tuesday, 9 September is a Wednesday, 11 September is a Friday, 12
 * September is a Saturday and 15 September is a Tuesday. Asia/Tehran is
 * UTC+03:30 with no daylight saving since 2022.
 */
import { describe, expect, it } from "vitest";

import {
  buildTimeline, dayAfterAt, dayBeforeAt, dayInZone, parseDemoDate, taskDueAt,
  todayInZone, zoneWeekday, zonedToUtc,
} from "../src/api/demo-seed/timeline.ts";
import { ALL_PACKS } from "../src/api/demo-seed/packs.ts";

const PACK_TIMES = {
  prior: { daysBefore: 7, hour: 9, minute: 0 },
  pricing: { daysBefore: 4, hour: 14, minute: 0 },
};

const at = (demoDate: string, now = new Date("2026-09-09T08:15:37.412Z")) =>
  buildTimeline({ demoDate, offsetMinutes: 20, ...PACK_TIMES, now });

describe("the demo timeline", () => {
  it("puts the weekly one-on-one exactly seven days back at 09:00 Tehran", () => {
    // 9 Sep − 7 = 2 Sep; 09:00 in a +03:30 zone is 05:30 UTC
    expect(at("2026-09-09").priorAt.toISOString()).toBe("2026-09-02T05:30:00.000Z");
  });

  it("puts the pricing call four days back at 14:00 Tehran when that is a working day", () => {
    // 10 Sep (Thursday) − 4 = 6 Sep, a Sunday, which is a working day in Iran
    const timeline = at("2026-09-10");
    expect(timeline.pricingAt.toISOString()).toBe("2026-09-06T10:30:00.000Z");
    expect(timeline.pricingMoved).toBe(false);
  });

  it("moves a Saturday pricing call back two days, to the Thursday", () => {
    // 9 Sep − 4 = 5 Sep, a Saturday → 3 Sep, a Thursday
    const timeline = at("2026-09-09");
    expect(timeline.pricingAt.toISOString()).toBe("2026-09-03T10:30:00.000Z");
    expect(timeline.pricingMoved).toBe(true);
  });

  it("moves a Friday pricing call back one day, to the same Thursday", () => {
    // 15 Sep − 4 = 11 Sep, a Friday → 10 Sep, a Thursday
    const timeline = at("2026-09-15");
    expect(timeline.pricingAt.toISOString()).toBe("2026-09-10T10:30:00.000Z");
    expect(timeline.pricingMoved).toBe(true);
  });

  it("never lands the pricing call on the Iranian weekend, on any day of a year", () => {
    let moved = 0;
    for (let day = 0; day < 365; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day));
      const iso = date.toISOString().slice(0, 10);
      const timeline = at(iso);
      const weekday = zoneWeekday(timeline.pricingAt);
      expect(weekday, `${iso} priced on weekday ${weekday}`).not.toBe(5);
      expect(weekday, `${iso} priced on weekday ${weekday}`).not.toBe(6);
      if (timeline.pricingMoved) moved++;
      /* and it never moves FORWARD past the demo day, or the "prior" record
         would not be prior */
      expect(timeline.pricingAt.getTime()).toBeLessThan(
        Date.parse(`${iso}T00:00:00.000Z`),
      );
    }
    /* the control: a rule that moved nothing would satisfy every line above
       on a year where four-days-back happened never to be a weekend */
    expect(moved).toBeGreaterThan(90);
  });

  it("puts the quote's deadline on the first Tuesday ON OR AFTER the demo day", () => {
    /* demo 9 Sep (Wednesday) → Tuesday the 15th; demo 10 Sep (Thursday) →
       the 15th too. The card is the presenter's one open item, and a
       deadline already behind them on the demo day would make "what should
       I do today" open with an apology (decided 2026-09-09). */
    expect(at("2026-09-09").quoteDueAt.toISOString()).toBe("2026-09-15T13:00:00.000Z");
    expect(at("2026-09-10").quoteDueAt.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  it("names the demo day itself when the demo runs on a Tuesday", () => {
    /* on or after, not strictly after: a Tuesday demo's quote is due today,
       which is exactly the line the presenter wants to say out loud */
    expect(at("2026-09-15").quoteDueAt.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  it("never falls before the demo day, and is always a Tuesday within the week, on any day of a year", () => {
    for (let day = 0; day < 365; day++) {
      const iso = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      const due = at(iso).quoteDueAt;
      expect(due.getUTCDay(), `${iso}`).toBe(2);
      const demoDay = Date.parse(`${iso}T13:00:00.000Z`);
      const ahead = (due.getTime() - demoDay) / 86_400_000;
      expect(ahead, `${iso}`).toBeGreaterThanOrEqual(0);
      expect(ahead, `${iso}`).toBeLessThanOrEqual(6);
    }
  });

  it("puts a day-relative upcoming meeting at its Tehran wall time", () => {
    // 9 Sep + 1 = 10 Sep; 10:00 in a +03:30 zone is 06:30 UTC
    expect(dayAfterAt("2026-09-09", 1, 10, 0).toISOString()).toBe("2026-09-10T06:30:00.000Z");
    // across a month end: 30 Sep + 1 = 1 Oct
    expect(dayAfterAt("2026-09-30", 1, 10, 0).toISOString()).toBe("2026-10-01T06:30:00.000Z");
  });

  it("puts the upcoming meeting `offset` minutes from NOW when the demo is today", () => {
    // 08:15:37Z is 11:45 in Tehran on the 9th, so the 9th IS today there
    const timeline = at("2026-09-09", new Date("2026-09-09T08:15:37.412Z"));
    expect(timeline.upcomingAt.toISOString()).toBe("2026-09-09T08:35:00.000Z");
  });

  it("puts it at 09:00 Tehran plus the offset when the demo is another day", () => {
    const timeline = at("2026-09-15", new Date("2026-09-09T08:15:37.412Z"));
    expect(timeline.upcomingAt.toISOString()).toBe("2026-09-15T05:50:00.000Z");
  });

  it("decides `today` in Tehran, not in UTC", () => {
    /* 21:30 UTC is already 01:00 the NEXT day in Tehran, so a demo dated the
       9th is no longer today — the discriminating case, and the one a UTC
       comparison gets wrong for three and a half hours every night */
    const late = new Date("2026-09-09T21:30:00.000Z");
    expect(dayInZone(late)).toEqual({ y: 2026, m: 9, d: 10 });
    expect(todayInZone(late)).toBe("2026-09-10");
    const timeline = at("2026-09-09", late);
    expect(timeline.upcomingAt.toISOString()).toBe("2026-09-09T05:50:00.000Z");
  });

  it("puts a card's deadline whole days out at 13:30 UTC", () => {
    expect(taskDueAt("2026-09-09", 2).toISOString()).toBe("2026-09-11T13:30:00.000Z");
    expect(taskDueAt("2026-09-09", 3).toISOString()).toBe("2026-09-12T13:30:00.000Z");
  });

  it("reads a wall clock in Tehran as +03:30", () => {
    expect(zonedToUtc(2026, 9, 2, 9, 0).toISOString()).toBe("2026-09-02T05:30:00.000Z");
    expect(zonedToUtc(2026, 9, 2, 0, 15).toISOString()).toBe("2026-09-01T20:45:00.000Z");
  });

  it("refuses a date that is not a real day", () => {
    expect(() => parseDemoDate("2026-02-30")).toThrow(/not a real day/);
    expect(() => parseDemoDate("9 September 2026")).toThrow(/YYYY-MM-DD/);
    expect(() => parseDemoDate("2026-9-9")).toThrow(/YYYY-MM-DD/);
    expect(parseDemoDate(" 2026-09-09 ")).toEqual({ y: 2026, m: 9, d: 9 });
  });

  describe("where the seeded conversations land", () => {
    it("puts one a whole number of days back at its Tehran wall time", () => {
      // 9 Sep − 6 = 3 Sep; 10:12 in a +03:30 zone is 06:42 UTC
      expect(dayBeforeAt("2026-09-09", 6, 10, 12).toISOString()).toBe("2026-09-03T06:42:00.000Z");
      // across a month start: 1 Oct − 3 = 28 Sep
      expect(dayBeforeAt("2026-10-01", 3, 16, 20).toISOString()).toBe("2026-09-28T12:50:00.000Z");
      // and an evening that is still the same Tehran day: 18:47 → 15:17 UTC
      expect(dayBeforeAt("2026-09-09", 1, 18, 47).toISOString()).toBe("2026-09-08T15:17:00.000Z");
    });

    it("keeps every conversation in the PAST on every demo date of a year", () => {
      /* the sidebar's order is `last_message_at desc`, so a thread stamped
         after the demo starts sorts above everything and reads as something
         the presenter has not said yet */
      for (const pack of ALL_PACKS) {
        for (let day = 0; day < 365; day++) {
          const iso = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
          const { y, m, d } = parseDemoDate(iso);
          const dayStarts = zonedToUtc(y, m, d, 0, 0);
          for (const conversation of pack.conversations) {
            const at = dayBeforeAt(iso, conversation.daysBefore, conversation.hour, conversation.minute);
            expect(at.getTime(), `${pack.language}/${conversation.key}/${iso}`)
              .toBeLessThan(dayStarts.getTime());
          }
        }
      }
    });

    it("puts a conversation ABOUT a recording after that recording, on every demo date", () => {
      /*
       * The one that would rot silently. `afterRecord` is data because the
       * PRICING CALL MOVES — four days back normally, five or six when that
       * lands on the Iranian weekend — so "three days before the demo" is
       * safely after it only because something checks, on the dates where
       * the call is at its earliest AND its latest. A conversation quoting a
       * call that had not happened yet is a contradiction a viewer reads off
       * two rows of the same sidebar.
       */
      let checked = 0;
      for (const pack of ALL_PACKS) {
        for (let day = 0; day < 365; day++) {
          const iso = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
          const timeline = buildTimeline({
            demoDate: iso, offsetMinutes: 20,
            prior: pack.records[0]!, pricing: pack.records[1]!,
            now: new Date("2026-09-09T08:15:37.412Z"),
          });
          const recorded = { prior: timeline.priorAt, pricing: timeline.pricingAt };
          for (const conversation of pack.conversations) {
            if (conversation.afterRecord === null) continue;
            const at = dayBeforeAt(iso, conversation.daysBefore, conversation.hour, conversation.minute);
            expect(
              at.getTime(),
              `${pack.language}/${conversation.key}/${iso}`,
            ).toBeGreaterThan(recorded[conversation.afterRecord].getTime());
            checked++;
          }
        }
      }
      /* the had-something-to-check assertion: a pack whose conversations all
         said `afterRecord: null` would satisfy every expectation above by
         running none of them */
      expect(checked).toBeGreaterThan(0);
    });
  });
});
