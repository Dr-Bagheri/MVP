import { afterEach, describe, expect, it } from "vitest";
import { monthKeyOf } from "./format";
import { __setPreferencesForTest } from "./preferences";

afterEach(() => __setPreferencesForTest({ calendar: "auto", timezone: "auto" }));

/**
 * «جلسات این ماه» counted by the browser's Gregorian month (2026-09-06): on
 * the Persian screen that spanned two Jalali months and never matched the
 * calendar one tile over. The key is the ACTIVE calendar's month, read in
 * the resolved zone — the same two facts every other date on the platform
 * is drawn from.
 */
describe("monthKeyOf — the calendar decides which month a moment is in", () => {
  it("splits one Gregorian month into two Jalali ones on the Persian screen", () => {
    __setPreferencesForTest({ calendar: "auto", timezone: "UTC" });
    /* 21 May 2026 = 31 Ordibehesht 1405; 22 May = 1 Khordad */
    expect(monthKeyOf("2026-05-21T12:00:00.000Z", "fa")).toBe("1405-2");
    expect(monthKeyOf("2026-05-22T12:00:00.000Z", "fa")).toBe("1405-3");
    /* the English screen is Gregorian, and the two share a month there */
    expect(monthKeyOf("2026-05-21T12:00:00.000Z", "en")).toBe("2026-5");
    expect(monthKeyOf("2026-05-22T12:00:00.000Z", "en")).toBe("2026-5");
  });

  it("reads the day in the STORED zone before asking the calendar", () => {
    __setPreferencesForTest({ calendar: "gregorian", timezone: "Asia/Tokyo" });
    /* 31 May 20:00Z is already 1 June in Tokyo */
    expect(monthKeyOf("2026-05-31T20:00:00.000Z", "en")).toBe("2026-6");
    __setPreferencesForTest({ timezone: "UTC" });
    expect(monthKeyOf("2026-05-31T20:00:00.000Z", "en")).toBe("2026-5");
  });
});
