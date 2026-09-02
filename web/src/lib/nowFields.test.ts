import { afterEach, describe, expect, it, vi } from "vitest";
import { instantFromFields, nowFields } from "./format";
import { __setPreferencesForTest } from "./preferences";

/**
 * A NEW MEETING OPENS AT THE CURRENT TIME (user directive, 2026-09-02).
 *
 * Worth a test because the failure is silent and plausible: a captured "now"
 * that stops being now looks exactly like a working clock that is behind.
 */
afterEach(() => vi.useRealTimers());

describe("nowFields", () => {
  it("is the wall clock the person is looking at", () => {
    vi.useFakeTimers();
    /* a time whose UTC and local forms DIFFER on most machines, and whose
       month and day both need padding — a fixture that agrees with the
       implementation on every axis proves nothing about any of them */
    vi.setSystemTime(new Date("2026-05-07T22:09:00.000Z"));
    const at = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    expect(nowFields()).toEqual({
      date: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
      time: `${two(at.getHours())}:${two(at.getMinutes())}`,
    });
  });

  it("round-trips through the parse the form actually uses", () => {
    /*
     * THE ASSERTION THAT MATTERS. The fields are read back with
     * `new Date(`${date}T${time}`)`, which parses LOCAL — so a helper that
     * emitted UTC strings would produce a meeting scheduled hours from when
     * the person chose, and every individual piece would still look right.
     */
    const at = new Date(2026, 4, 7, 22, 9);
    const { date, time } = nowFields(at);
    const parsed = new Date(`${date}T${time}`);
    expect(parsed.getHours()).toBe(22);
    expect(parsed.getMinutes()).toBe(9);
    expect(parsed.getDate()).toBe(7);
  });

  it("pads a single-digit month, day, hour and minute", () => {
    expect(nowFields(new Date(2026, 0, 2, 3, 4))).toEqual({ date: "2026-01-02", time: "03:04" });
  });
});

describe("the platform's clock, not the browser's", () => {
  it("reads the stored zone — the bug a developer in that zone cannot see", () => {
    /*
     * User report, 2026-09-02: "the time still not the same as the platform
     * time when go for new meeting". Every other time on the platform renders
     * in `resolvedTimezone()`; this one read the browser's, so on a machine
     * outside the stored zone the form opened at a time the rest of the
     * screen said it was not.
     *
     * The fixture is the whole point: a zone DELIBERATELY different from the
     * machine running the test. A test written in the developer's own zone
     * passes against the bug, which is how it shipped.
     */
    __setPreferencesForTest({ timezone: "Asia/Tokyo" });
    const at = new Date("2026-05-07T22:09:00.000Z"); // 07:09 next day in Tokyo
    expect(nowFields(at)).toEqual({ date: "2026-05-08", time: "07:09" });
    __setPreferencesForTest({ timezone: "UTC" });
    expect(nowFields(at)).toEqual({ date: "2026-05-07", time: "22:09" });
  });

  it("round-trips through the zone it wrote — the half that stores the instant", () => {
    /*
     * Fixing only the display would have been worse than leaving it: a form
     * showing the right time and saving the wrong one is a meeting that
     * happens at an hour nobody chose.
     */
    __setPreferencesForTest({ timezone: "Asia/Tokyo" });
    const at = new Date("2026-05-07T22:09:00.000Z");
    const { date, time } = nowFields(at);
    expect(instantFromFields(date, time).toISOString()).toBe(at.toISOString());
  });
});
