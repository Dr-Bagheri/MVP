import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings · General, after the 2026-08-29 pair of directives (the workspace
 * card removed, a theme control added) and the 2026-09-16 trio: the language
 * moved here from the top bar, the time zones named in the screen's words,
 * and a live clock at the date card's other end.
 *
 * Every half is the kind of change that is easy to *look* done. A removed
 * card leaves its fetch behind — a request for a screen nobody can see, which
 * costs a round trip and shows up in no test that only reads the DOM. And a
 * theme control is the platform's own worst case: this repo has already
 * shipped a version where two stores held one theme, so the pre-paint script
 * read a key the toggle never wrote and produced the exact flash it exists to
 * prevent, and a later one where a preference changed the store and NOTHING
 * on screen followed, because nothing subscribed to it.
 *
 * So the theme is asserted in BOTH directions, and so is the clock: writing
 * to the shared store is the easy half and a private `useState` would pass
 * it. Only a change made from OUTSIDE — exactly as another surface makes it
 * — can tell one shared state from two that agree at first render and drift
 * on the next.
 */

/** the fetch the removed card owned; a spy so its ABSENCE is assertable */
const me = vi.fn();
const setLocale = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    setLocale: (locale: string) => setLocale(locale),
    /* `@/lib/preferences` imports the client for its save path; those two
       are exercised by their own suite and stubbed to never resolve here */
    updatePreferences: () => new Promise(() => {}),
  },
}));

const replace = vi.fn();
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["fa", "en"], defaultLocale: "fa", localeDetection: false },
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/settings/general",
}));

const { GeneralSettings } = await import("./GeneralSettings");
/** the producer's own constants — never a literal copy of the key or the
    default, which is precisely the drift that caused the flash */
const { DEFAULT_THEME, THEME_STORAGE_KEY, storeTheme } = await import("@/lib/theme");
const { __setPreferencesForTest } = await import("@/lib/preferences");

beforeEach(() => {
  me.mockReset();
  me.mockResolvedValue(null);
  setLocale.mockReset();
  setLocale.mockResolvedValue({});
  replace.mockReset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  __setPreferencesForTest({ calendar: "auto", timezone: "auto" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the workspace card, and what left with it", () => {
  it("never asks for an identity — the card that needed one is gone", async () => {
    render(<GeneralSettings />);
    /*
     * Every mount effect gets its chance to misbehave before the claim is
     * made. `me()` was called unconditionally by the previous version, so
     * this fails loudly if the fetch outlives the card it fed.
     */
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(me).not.toHaveBeenCalled();
  });

  it("renders exactly the three cards — theme, language, dates and time", async () => {
    render(<GeneralSettings />);
    const headings = await screen.findAllByRole("heading");
    /*
     * The list, not a count: a count is a fact about this render wearing the
     * costume of a fact about the screen. These three ARE the screen now.
     */
    expect(headings.map((heading) => heading.textContent)).toEqual(["پوسته", "زبان رابط", "تاریخ و زمان"]);
  });
});

describe("the theme control", () => {
  /**
   * The theme control, told from the calendar and timezone ones by its own
   * accessible name rather than by its position in the document.
   *
   * It is a BUTTON, not a `<select>` (2026-09-03): the platform's dropdowns
   * are the themed `Select` everywhere now, because a native one draws the
   * browser's own panel in the browser's own colours — a white list under a
   * dark control. `aria-haspopup="listbox"` is what it is; `combobox` was what
   * the old element was.
   */
  const themeSelect = () => screen.getByRole("combobox", { name: "پوسته" });
  /** open it and read the choices it offers */
  const themeOptions = async () => {
    await userEvent.click(themeSelect());
    return [...document.querySelectorAll('[role="option"]')]
      .map((o) => o.getAttribute("data-value"));
  };

  it("offers exactly the two values the store can hold", async () => {
    render(<GeneralSettings />);
    const options = await themeOptions();
    /*
     * The store is `"light" | "dark"`; there is no `system`. An option the
     * store cannot hold would not fail — a select whose value matches no
     * option silently displays a DIFFERENT one, so the person would pick
     * "system" and watch the box say "dark". Two options, both real.
     */
    expect(options).toEqual(["dark", "light"]);
    expect(options).toContain(DEFAULT_THEME);
  });

  it("writes the one store the pre-paint script reads", async () => {
    render(<GeneralSettings />);
    await userEvent.click(themeSelect());
    await userEvent.click(await screen.findByRole("option", { name: "روشن" }));

    /*
     * The KEY comes from the producer. A literal here would agree with a
     * second store just as happily as with the real one — which is how the
     * first version of this bug survived: every half was internally correct.
     */
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    // and the document is repainted now, not on the next load
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows a change made from OUTSIDE it — one state, not a private copy", async () => {
    render(<GeneralSettings />);
    /* the TRIGGER shows the current value — that is what a person reads */
    expect(themeSelect().textContent).toContain(DEFAULT_THEME === "dark" ? "تیره" : "روشن");

    /*
     * **The discriminating assertion.** This is another surface writing the
     * theme while this screen is mounted. A `useState` initialised from
     * `localStorage` passes every assertion above and fails here — and then
     * writes its stale value back the next time someone touches the select,
     * which is the whole mechanism of the two-stores incident.
     */
    act(() => storeTheme("light"));
    await waitFor(() => expect(themeSelect().textContent).toContain("روشن"));

    act(() => storeTheme("dark"));
    await waitFor(() => expect(themeSelect().textContent).toContain("تیره"));
  });
});

/**
 * The language, moved here from the top bar (user, 2026-09-16: "remove the
 * fa, en version from the top menu and put it in settings general page").
 */
describe("the language control", () => {
  /* the card wears the catalogue's existing word for the setting — «زبان
     رابط», the profile page's preferences row uses the same key */
  const languageSelect = () => screen.getByRole("combobox", { name: "زبان رابط" });

  it("offers the router's own locales, named in the screen's words", async () => {
    render(<GeneralSettings />);
    await userEvent.click(languageSelect());
    const options = [...document.querySelectorAll('[role="option"]')];
    /* the VALUES are the producer's list (a third locale added to the
       router appears here with no second list to edit); the LABELS are the
       catalogue's — «فارسی» and «انگلیسی» on the Persian screen, never "en" */
    expect(options.map((o) => o.getAttribute("data-value"))).toEqual(["fa", "en"]);
    expect(options.map((o) => o.textContent?.trim())).toEqual(["فارسی", "انگلیسی"]);
  });

  it("re-renders the SAME route under the other prefix, and remembers the choice", async () => {
    render(<GeneralSettings />);
    await userEvent.click(languageSelect());
    await userEvent.click(await screen.findByRole("option", { name: "انگلیسی" }));
    /* the pair's one rule, kept: nobody loses their place for a preference */
    expect(replace).toHaveBeenCalledWith("/settings/general", { locale: "en" });
    /* and the choice follows the person to their next device */
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith("en"));
  });

  it("does nothing when the current language is chosen again — the control", async () => {
    render(<GeneralSettings />);
    await userEvent.click(languageSelect());
    await userEvent.click(await screen.findByRole("option", { name: "فارسی" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(replace).not.toHaveBeenCalled();
    expect(setLocale).not.toHaveBeenCalled();
  });
});

/**
 * The time zones, in words (user, 2026-09-16: "this dropdown still is in
 * english, translate it").
 */
describe("the time-zone control", () => {
  const zoneSelect = () => screen.getByRole("combobox", { name: "منطقهٔ زمانی" });

  it("stores the identifier and shows the screen's word for it", async () => {
    __setPreferencesForTest({ timezone: "Asia/Tehran" });
    render(<GeneralSettings />);
    /* the trigger reads the WORD — the id is what the row holds */
    expect(zoneSelect().textContent).toContain("تهران");
    expect(zoneSelect().textContent).not.toContain("Asia");

    await userEvent.click(zoneSelect());
    const options = [...document.querySelectorAll('[role="option"]')];
    const values = options.map((o) => o.getAttribute("data-value"));
    expect(values).toContain("Asia/Tehran");
    expect(values).toContain("UTC");
    /* not one option reads in Latin on the Persian screen — the identifier
       written back as its own label would satisfy every line above */
    for (const option of options) {
      expect(option.textContent, `${option.getAttribute("data-value")} is not in Persian`).not.toMatch(/[A-Za-z]/);
    }
  });
});

/**
 * The clock at the date card's other end (user, 2026-09-16: "put the exact
 * date and time"). Driven on fake timers with a pinned instant, so the
 * reading is a known string rather than whatever the machine's clock says.
 */
describe("the live clock", () => {
  it("reads the platform's date and time, ticks, and follows the zone preference", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T10:20:30.000Z"));
    __setPreferencesForTest({ calendar: "jalali", timezone: "Asia/Tehran" });

    const { container } = render(<GeneralSettings />);
    const clock = () => container.querySelector("time")!;
    /* 10:20:30Z is 13:50:30 in Tehran, on ۲۵ شهریور ۱۴۰۵ — the same two
       formatters every other date on the platform goes through */
    expect(clock().textContent).toContain("۲۵ شهریور ۱۴۰۵");
    expect(clock().textContent).toMatch(/۱۳:۵۰:۳۰$/);

    /* it is alive: one second later the seconds hand has moved */
    act(() => { vi.advanceTimersByTime(1000); });
    expect(clock().textContent).toMatch(/۱۳:۵۰:۳۱$/);

    /* THE DISCRIMINATING HALF: the zone changes from OUTSIDE (the preference
       store, as the picker beside it writes) and the reading moves in the
       same render — a clock that formatted once on mount would keep saying
       Tehran's hour under a UTC preference */
    act(() => { __setPreferencesForTest({ timezone: "UTC" }); });
    expect(clock().textContent).toMatch(/۱۰:۲۰:۳۱$/);
  });
});
