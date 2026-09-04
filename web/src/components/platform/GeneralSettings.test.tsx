import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings · General, after the 2026-08-29 pair of directives: the workspace
 * card removed, a theme control added.
 *
 * Both halves are the kind of change that is easy to *look* done. A removed
 * card leaves its fetch behind — a request for a screen nobody can see, which
 * costs a round trip and shows up in no test that only reads the DOM. And a
 * theme control is the platform's own worst case: this repo has already
 * shipped a version where two stores held one theme, so the pre-paint script
 * read a key the toggle never wrote and produced the exact flash it exists to
 * prevent, and a later one where a preference changed the store and NOTHING
 * on screen followed, because nothing subscribed to it.
 *
 * So the theme is asserted in BOTH directions. Writing to the shared store is
 * the easy half and a private `useState` would pass it. Only the second
 * assertion — a change made from OUTSIDE this component, exactly as the
 * avatar menu makes it — can tell one shared state from two that agree at
 * first render and drift on the next.
 */

/** the fetch the removed card owned; a spy so its ABSENCE is assertable */
const me = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    me: () => me(),
    /* `@/lib/preferences` imports the client for its save path; those two
       are exercised by their own suite and stubbed to never resolve here */
    updatePreferences: () => new Promise(() => {}),
  },
}));

const { GeneralSettings } = await import("./GeneralSettings");
/** the producer's own constants — never a literal copy of the key or the
    default, which is precisely the drift that caused the flash */
const { DEFAULT_THEME, THEME_STORAGE_KEY, storeTheme } = await import("@/lib/theme");

beforeEach(() => {
  me.mockReset();
  me.mockResolvedValue(null);
  localStorage.clear();
  delete document.documentElement.dataset.theme;
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

  it("renders exactly the two cards that remain", async () => {
    render(<GeneralSettings />);
    const headings = await screen.findAllByRole("heading");
    /*
     * The list, not a count: a count is a fact about this render wearing the
     * costume of a fact about the screen. These two ARE the screen now.
     */
    expect(headings.map((heading) => heading.textContent)).toEqual(["پوسته", "تاریخ و زمان"]);
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
     * **The discriminating assertion.** This is the avatar menu writing the
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
