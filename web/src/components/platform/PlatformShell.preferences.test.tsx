import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/format";
import { __setPreferencesForTest } from "@/lib/preferences";

/** The preference now lives on the person; this sets the local projection the
 *  way a hydrate or a successful save would, without a round trip. */
const setCalendarPreference = (calendar: "auto" | "jalali" | "gregorian") =>
  __setPreferencesForTest({ calendar });

/**
 * **A preference that changes nothing on screen is a setting that lies.**
 *
 * `formatDate` reads the calendar preference directly, which is what lets every
 * date in the product honour it without touching a single call site. But a
 * store nothing subscribes to re-renders nothing: choosing "Gregorian" in the
 * avatar menu updated the stored value and left every visible date exactly as
 * it was, until the next navigation. The control looked wired and did nothing.
 *
 * The unit tests could not see it — they call `formatDate` directly, after
 * setting the preference, so they exercise the formatter and never the
 * subscription. Only a rendered date changing (or failing to) shows this, which
 * is the rendered-artifact rule applied to state rather than to CSS.
 *
 * So this test renders a date INSIDE the shell and changes the preference from
 * outside it, exactly as the menu does.
 */
vi.mock("@/api/client", () => ({
  api: { me: async () => null },
}));

/*
 * The chrome is stubbed, not the shell: the rail, bar and bottom bar need
 * router and intl context and none of them is what this test is about. The
 * shell itself stays REAL, because the thing under test is precisely what the
 * shell does around `children`.
 */
vi.mock("./IconRail", () => ({ IconRail: () => null }));
vi.mock("./TopBar", () => ({ TopBar: () => null }));
vi.mock("./BottomBar", () => ({ BottomBar: () => null }));

const { PlatformShell } = await import("./PlatformShell");

function DateUnderTest() {
  return <span data-testid="date">{formatDate("2026-06-14T09:00:00Z", "fa")}</span>;
}

describe("preferences reach what is already on screen", () => {
  beforeEach(() => {
    localStorage.clear();
    setCalendarPreference("auto");
  });

  it("re-renders a date already on screen when the calendar changes", async () => {
    render(
      <PlatformShell>
        <DateUnderTest />
      </PlatformShell>,
    );

    // anchored on the value that only exists once the shell has rendered the
    // child — not merely awaited, or this would pass against an empty tree
    await waitFor(() => expect(screen.getByTestId("date")).toHaveTextContent("خرداد"));

    setCalendarPreference("gregorian");

    await waitFor(() => expect(screen.getByTestId("date")).toHaveTextContent("Jun"));
  });

  it("goes back when the preference goes back", async () => {
    render(
      <PlatformShell>
        <DateUnderTest />
      </PlatformShell>,
    );
    await waitFor(() => expect(screen.getByTestId("date")).toHaveTextContent("خرداد"));

    setCalendarPreference("gregorian");
    await waitFor(() => expect(screen.getByTestId("date")).toHaveTextContent("Jun"));

    // both directions: a one-way check passes against a component that renders
    // Gregorian unconditionally once anything changes
    setCalendarPreference("auto");
    await waitFor(() => expect(screen.getByTestId("date")).toHaveTextContent("خرداد"));
  });
});
