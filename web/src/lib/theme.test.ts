import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  readStoredTheme,
  storeTheme,
  themeBootScript,
  THEME_STORAGE_KEY,
} from "./theme";

/**
 * These tests are about a SEAM, not a function: the pre-paint script and the
 * components that write the preference have to agree about a key and a default,
 * and for a while they did not — two stores, two defaults, opposite ones.
 *
 * So the assertions deliberately RUN the script rather than compare its text.
 * A string-equality test would have passed happily against the broken pair as
 * long as the string matched itself, which is the whole failure mode: both
 * halves internally consistent, the pair silently wrong.
 *
 * Verified red against the previous code (`echo-theme` / default `"light"`):
 * the no-preference case and the stored-dark case both failed.
 */
function runBootScript(): string | undefined {
  document.documentElement.removeAttribute("data-theme");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(themeBootScript())();
  return document.documentElement.dataset.theme;
}

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("paints the platform default when nothing is stored", () => {
    // the bug: a first-time visitor was painted in the wrong theme, then flipped to dark
    expect(runBootScript()).toBe(DEFAULT_THEME);
    /* LIGHT since the Arameet adoption (2026-08-31) — the reference's
       primary look is its light theme, and the default follows it */
    expect(DEFAULT_THEME).toBe("light");
  });

  it("paints what the toggle stored — for BOTH values", () => {
    // both directions, because the broken pair happened to agree on "light"
    // and only disagreed on "dark"; testing one value proves nothing here
    storeTheme("light");
    expect(runBootScript()).toBe("light");

    storeTheme("dark");
    expect(runBootScript()).toBe("dark");
  });

  it("reads the same key the toggle writes", () => {
    storeTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(readStoredTheme()).toBe("light");
    expect(runBootScript()).toBe("light");
  });

  it("falls back to the default on a junk stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
    expect(runBootScript()).toBe(DEFAULT_THEME);
  });

  it("applies the theme to the document, not just to storage", () => {
    storeTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
