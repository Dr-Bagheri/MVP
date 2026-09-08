import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * A TILE'S EMPTY STATE IS ONE SHAPE (user, 2026-09-08: "put No meetings yet
 * the same way in middle with icon like the upcoming meetings").
 *
 * «جلسات پیش‌رو» had grown a centred icon-over-text state of its own while
 * «آخرین جلسات» three hundred lines below used a left-aligned paragraph — two
 * drawings of one state, which is the pair that stops matching the first time
 * either is touched.
 *
 * The assertion is the PAIR, and it has to be: "the latest panel has an icon"
 * is satisfied by any icon anywhere, and "both are centred" is satisfied by a
 * version that centres nothing because neither rendered. So both panels are
 * rendered empty in one test and their empty states compared to each other —
 * same wrapper classes, an icon in each.
 */

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/api/client", () => ({
  BffError: class BffError extends Error {},
  /* NOTHING scheduled and nothing held — the org's first day, which is the
     state both panels are about */
  api: { meetings: async () => [] },
}));

import { UpcomingWidget, LatestMeetingsWidget } from "./miniWidgets";

/* vitest.setup.ts mocks `next-intl` globally against the REAL fa.json, so a
   provider here would be a second, weaker source of the same strings */
function draw(node: React.ReactNode) {
  return render(<>{node}</>);
}

/** the box an empty state draws itself in — the element carrying its icon */
function shapeOf(text: string): { wrapper: string; hasIcon: boolean } {
  const line = screen.getByText(text);
  const block = line.parentElement;
  const wrapper = block?.parentElement;
  if (wrapper === null || wrapper === undefined || block === null) {
    throw new Error("no wrapper around " + text);
  }
  return {
    wrapper: wrapper.className,
    hasIcon: block.querySelector("svg") !== null,
  };
}

describe("an empty tile says its nothing in the middle, with an icon", () => {
  it("draws «هنوز جلسه‌ای نیست.» exactly as «جلسه‌ای در پیش نداری.»", async () => {
    draw(<UpcomingWidget />);
    await waitFor(() => expect(screen.getByText("جلسه‌ای در پیش نداری.")).toBeInTheDocument());
    const upcoming = shapeOf("جلسه‌ای در پیش نداری.");

    draw(<LatestMeetingsWidget />);
    await waitFor(() => expect(screen.getByText("هنوز جلسه‌ای نیست.")).toBeInTheDocument());
    const latest = shapeOf("هنوز جلسه‌ای نیست.");

    /* the DISCRIMINATING half: each has an icon AND they are the same box.
       Either alone passes against a version that gives one panel an icon and
       leaves the other's paragraph where it was. */
    expect(upcoming.hasIcon).toBe(true);
    expect(latest.hasIcon).toBe(true);
    expect(latest.wrapper).toBe(upcoming.wrapper);
    expect(latest.wrapper).toContain("place-items-center");
  });
});
