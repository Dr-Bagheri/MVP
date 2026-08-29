import { beforeEach, describe, expect, it } from "vitest";
import { __setPreferencesForTest } from "./preferences";
import { dayKeyOf, monthGrid } from "./format";

/**
 * THE MONTH GRID, scored against a calendar we did not write.
 *
 * Every expectation below comes from `Intl`'s own Persian calendar rather
 * than from our `jalaliFromParts` — the fixture-independence rule at its most
 * literal, because a grid derived from the same arithmetic it is tested with
 * agrees with itself no matter how wrong it is. Two independent
 * implementations agreeing is evidence; one agreeing with itself is not.
 *
 * The ground truth, read off `Intl.DateTimeFormat("en-u-ca-persian")`:
 *
 *   2026-08-23  =  1 Shahrivar 1405   (a SUNDAY)
 *   2026-08-29  =  7 Shahrivar 1405   (a Saturday)
 *   Shahrivar is a 31-day month
 *
 * The column a date lands in is the thing worth testing: a calendar that is
 * one square off is still a calendar, still renders, and is wrong about every
 * date in it.
 */

/** noon, so no timezone this test runs in can push it onto another day */
const AUG_29 = new Date("2026-08-29T12:00:00Z");

beforeEach(() => {
  __setPreferencesForTest({ calendar: "auto", timezone: "UTC" });
});

describe("the Jalali month grid", () => {
  it("names the month the way the reader's calendar does", () => {
    expect(monthGrid(AUG_29, "fa").title).toBe("شهریور ۱۴۰۵");
  });

  it("starts the week on Saturday, and puts the 1st in the right column", () => {
    const grid = monthGrid(AUG_29, "fa");
    expect(grid.weekdays[0]).toBe("ش");

    /*
     * 1 Shahrivar is a Sunday, and Sunday is the SECOND column of a
     * Saturday-first week — so exactly one padding square precedes it. This
     * is the assertion a column-off calendar fails.
     */
    const first = grid.cells.findIndex((cell) => cell.inMonth);
    expect(first).toBe(1);
    expect(grid.cells[first]!.key).toBe(Date.UTC(2026, 7, 23));
  });

  it("holds the month's 31 days, in whole weeks", () => {
    const grid = monthGrid(AUG_29, "fa");
    expect(grid.cells.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(grid.cells.length % 7).toBe(0);
  });

  it("marks today, and only today", () => {
    const grid = monthGrid(AUG_29, "fa");
    const today = grid.cells.filter((cell) => cell.today);
    expect(today).toHaveLength(1);
    expect(today[0]!.label).toBe("۷");
    expect(today[0]!.key).toBe(dayKeyOf(AUG_29));
  });

  it("gives an event's day the SAME key its square carries", () => {
    // the whole point of the key: a tile can put an event on a date without
    // either side re-deriving what "that day" means
    const grid = monthGrid(AUG_29, "fa");
    const event = dayKeyOf("2026-08-25T06:30:00.000Z");
    const square = grid.cells.find((cell) => cell.key === event);
    expect(square?.label).toBe("۳");
  });
});

describe("the Gregorian month grid", () => {
  beforeEach(() => {
    __setPreferencesForTest({ calendar: "gregorian", timezone: "UTC" });
  });

  it("names the month and starts the week on Sunday", () => {
    const grid = monthGrid(AUG_29, "en");
    expect(grid.title).toBe("August 2026");
    expect(grid.weekdays[0]).toBe("S");

    // 1 August 2026 is a Saturday — the LAST column of a Sunday-first week,
    // so six padding squares precede it
    const first = grid.cells.findIndex((cell) => cell.inMonth);
    expect(first).toBe(6);
    expect(grid.cells[first]!.key).toBe(Date.UTC(2026, 7, 1));
    expect(grid.cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });
});
