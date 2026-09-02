import { beforeEach, describe, expect, it, vi } from "vitest";

const updatePreferences = vi.fn();
vi.mock("@/api/client", () => ({ api: { updatePreferences: () => updatePreferences() } }));

const { formatDate, formatTime } = await import("./format");
const {
  resolvedCalendar,
  saveCalendarPreference,
  hydratePreferences,
  getCalendarPreference,
  __setPreferencesForTest,
} = await import("./preferences");

/** The old sync setters are gone — preferences live on the person now. */
const setCalendarPreference = (calendar: "auto" | "jalali" | "gregorian") =>
  __setPreferencesForTest({ calendar });
const setTimezonePreference = (timezone: string) => __setPreferencesForTest({ timezone });

/**
 * The calendar preference carries a RULING — "Auto (follows language)" is the
 * default precisely so that an explicit choice can override the locale-solid
 * behaviour without replacing it. So the test walks all four combinations
 * rather than the one that happens to be the default: auto is the interesting
 * case in fa, and the override is the interesting case in en, and asserting
 * either alone proves the wrong half.
 */
describe("calendar preference", () => {
  beforeEach(() => {
    setCalendarPreference("auto");
    setTimezonePreference("UTC");
  });

  it("auto follows the language, in both directions", () => {
    expect(resolvedCalendar("fa")).toBe("jalali");
    expect(resolvedCalendar("en")).toBe("gregorian");
  });

  it("an explicit choice decides the PERSIAN surface", () => {
    setCalendarPreference("gregorian");
    expect(resolvedCalendar("fa")).toBe("gregorian");
  });

  it("but English is always Gregorian, whatever is stored", () => {
    /*
     * REVERSES the 2026-08-13 rule that an explicit choice overrides the
     * locale in both directions (user directive, 2026-09-02). That rule was
     * defensible and it produced «1405 شهریور 11» on an English screen —
     * Latin digits, a Persian month name, and a year no English reader can
     * place. The setting was being honoured into unreadability.
     *
     * Asserted for BOTH stored values, because "en is gregorian" would also
     * be true of an implementation that had simply stopped reading the
     * preference at all — and that one breaks Persian.
     */
    setCalendarPreference("jalali");
    expect(resolvedCalendar("en")).toBe("gregorian");
    expect(resolvedCalendar("fa")).toBe("jalali");
    setCalendarPreference("gregorian");
    expect(resolvedCalendar("en")).toBe("gregorian");
  });

  it("renders a Jalali date in fa by default", () => {
    // 2026-06-14 → 24 خرداد 1405
    expect(formatDate("2026-06-14T09:00:00Z", "fa")).toBe("⁨۲۴ خرداد ۱۴۰۵⁩");
  });

  it("renders a Gregorian date in en by default", () => {
    expect(formatDate("2026-06-14T09:00:00Z", "en")).toBe("⁨14 Jun 2026⁩");
  });

  it("keeps DIGITS with the language when the calendar is overridden", () => {
    /*
     * The two are separate axes and it is easy to tie them together by
     * accident. Digits belong to the language; months belong to the calendar.
     * A Persian UI showing a Gregorian date still counts in Persian digits.
     */
    setCalendarPreference("gregorian");
    expect(formatDate("2026-06-14T09:00:00Z", "fa")).toBe("⁨۱۴ Jun ۲۰۲۶⁩");
  });
});

describe("timezone preference", () => {
  beforeEach(() => {
    setCalendarPreference("gregorian");
  });

  it("changes which DAY an instant falls on", () => {
    /*
     * The discriminating case, and the reason this preference is not
     * decoration: 22:30 UTC is already tomorrow in Tehran. A formatter that
     * ignored the zone would return the same date for both, so this is the
     * assertion that fails if the preference is quietly unused.
     */
    const instant = "2026-06-14T22:30:00Z";
    expect(formatDate(instant, "en")).toBe("⁨14 Jun 2026⁩");
    setTimezonePreference("Asia/Tehran");
    expect(formatDate(instant, "en")).toBe("⁨15 Jun 2026⁩");
  });

  it("changes the clock time too", () => {
    setTimezonePreference("UTC");
    expect(formatTime("2026-06-14T22:30:00Z", "en")).toBe("22:30");
    setTimezonePreference("Asia/Tokyo");
    expect(formatTime("2026-06-14T22:30:00Z", "en")).toBe("07:30");
  });

  it("falls back rather than blanking every date on an invalid zone", () => {
    /*
     * core/ validates the zone against what the runtime can render, so this
     * should be unreachable. It stays as a backstop, and B1's own framing is
     * the reason: a fallback that never runs is the right kind of dead code —
     * the kind that catches the case nobody predicted.
     */
    setTimezonePreference("Mars/Olympus_Mons");
    expect(formatDate("2026-06-14T09:00:00Z", "en")).toMatch(/^⁨1[45] Jun 2026⁩$/);
  });
});

/**
 * The preference lives on the PERSON now. What matters at this seam is that
 * the projection only ever holds a value the server accepted — the whole
 * reason the save is not optimistic.
 */
describe("preferences come from the wire", () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    __setPreferencesForTest({ calendar: "auto", timezone: "UTC" });
  });

  it("adopts what identity carried", () => {
    hydratePreferences({ calendar: "jalali", timezone: "Asia/Tehran" });
    expect(getCalendarPreference()).toBe("jalali");
    /* the stored value is adopted, and it shows on the surface it governs —
       Persian. English is Gregorian whatever is stored (2026-09-02). */
    expect(formatDate("2026-06-14T09:00:00Z", "fa")).toContain("خرداد");
  });

  it("falls back to auto on a value this client does not understand", () => {
    // the wire is not a trusted input; an unknown calendar must not reach the
    // formatter as a calendar nobody can render
    hydratePreferences({ calendar: "mayan" as never, timezone: "UTC" });
    expect(getCalendarPreference()).toBe("auto");
  });

  it("does NOT change what is on screen when the server refuses", async () => {
    /*
     * The discriminating case for save-then-adopt. An optimistic update would
     * redraw every date in a calendar the server rejected and then revert —
     * the UI claiming a setting was saved when it was not.
     */
    hydratePreferences({ calendar: "gregorian", timezone: "UTC" });
    updatePreferences.mockRejectedValue(new Error("calendar_unknown"));

    await expect(saveCalendarPreference("jalali")).rejects.toThrow();
    expect(getCalendarPreference()).toBe("gregorian");
  });

  it("adopts the SERVER's value on success, not the one it was asked for", async () => {
    // the response is the authority — if core/ normalised it, that is the value
    updatePreferences.mockResolvedValue({ calendar: "auto", timezone: "Asia/Tehran" });
    await saveCalendarPreference("jalali");
    expect(getCalendarPreference()).toBe("auto");
  });
});
