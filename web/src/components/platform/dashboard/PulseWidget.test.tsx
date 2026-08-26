import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/api/client", () => ({ api: {} }));
vi.mock("@/lib/assistantBus", () => ({ openAssistant: vi.fn() }));
vi.mock("@/components/rowActions", () => ({ SelectMenu: () => null }));
vi.mock("@/i18n/routing", () => ({ Link: ({ children }: { children: unknown }) => children }));

import { PulseWidget } from "./widgets";
import type { DashboardData } from "./useDashboardData";

/**
 * The activity chart is an SVG the eye reads as a trend. These assert the
 * three things a picture cannot be trusted about: that it drew something,
 * that a bigger tier draws MORE of it, and that a failed read draws none
 * of it rather than a flat line at zero.
 */

function day(offset: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d.toISOString();
}

const base: DashboardData = {
  calls: [],
  directory: [],
  records: [],
  actions: [],
  decisions: [],
  laneDepth: 0,
  appearances: [],
  topics: [],
  tagsAvailable: false,
  failed: false,
};

/**
 * `spread` puts one record on each of the last `n` DAYS. It matters that
 * the days are distinct: the first version of this fixture used `i % 5`,
 * so forty records landed on five days, every tier showed five columns,
 * and the additive assertion could not have failed however wrong the code
 * was. A fixture that cannot distinguish the tiers cannot test them.
 */
const withCalls = (n: number, spread = true): DashboardData => ({
  ...base,
  calls: Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    started_at: day(spread ? i : i % 5),
    duration_ms: 600_000 + i * 60_000,
    status: "ready",
    deleted_at: null,
  })) as DashboardData["calls"],
});

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  expect(svg, "the chart drew no svg at all").not.toBeNull();
  return svg as SVGSVGElement;
}

describe("the activity chart", () => {
  it("draws an area, a line and an endpoint when there is data", () => {
    const { container } = render(<PulseWidget data={withCalls(6)} size="large" />);
    const svg = svgOf(container);
    // a filled area, a stroked edge, and the two endpoint circles
    const filled = [...svg.querySelectorAll("path")].filter(
      (p) => (p.getAttribute("fill") ?? "").startsWith("url("));
    const stroked = [...svg.querySelectorAll("path")].filter(
      (p) => p.getAttribute("stroke") === "currentColor");
    expect(filled.length, "no gradient area").toBe(1);
    expect(stroked.length, "no line").toBe(1);
    expect(svg.querySelectorAll("circle").length, "no endpoint").toBe(2);
  });

  it("draws a column for every day that had a record, and none for the rest", () => {
    // three distinct days carry records; the range is 21 days at `large`
    const { container } = render(<PulseWidget data={withCalls(3)} size="large" />);
    const columns = svgOf(container).querySelectorAll("rect");
    expect(columns.length).toBe(3);
  });

  it("counts a day ONCE however many records it holds", () => {
    // five records, all on the same day — one column, not five
    const { container } = render(
      <PulseWidget data={withCalls(5, false)} size="large" />);
    const days = new Set(
      [...svgOf(container).querySelectorAll("rect")].map((r) => r.getAttribute("x")));
    expect(days.size).toBe(svgOf(container).querySelectorAll("rect").length);
  });

  it("is ADDITIVE: a bigger tier shows a longer range", () => {
    // the same law as the tile sizes — growing the card must not show less
    const ranges = (["small", "wide", "large", "hero"] as const).map((size) => {
      const { container, unmount } = render(<PulseWidget data={withCalls(40)} size={size} />);
      // every day in range contributes a grid-independent point; count the
      // columns, which only exist for days that had a record
      const n = svgOf(container).querySelectorAll("rect").length;
      unmount();
      return n;
    });
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!).toBeGreaterThanOrEqual(ranges[i - 1]!);
    }
    expect(ranges.at(-1)!).toBeGreaterThan(ranges[0]!);
  });

  it("draws NOTHING when the read failed — not a flat line at zero", () => {
    /**
     * The distinction this whole dashboard turns on. A chart with no data
     * and a chart whose data could not be read look identical if both draw
     * a baseline, and only one of them means "nothing happened".
     */
    const { container } = render(
      <PulseWidget data={{ ...withCalls(5), failed: true }} size="large" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("readFailed")).toBeInTheDocument();
  });

  it("gives each instance its own gradient id", () => {
    // two charts on one board sharing a gradient id means the second one
    // silently repaints the first
    const a = render(<PulseWidget data={withCalls(4)} size="large" />);
    const b = render(<PulseWidget data={withCalls(4)} size="hero" />);
    const idA = svgOf(a.container).querySelector("linearGradient")?.id;
    const idB = svgOf(b.container).querySelector("linearGradient")?.id;
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});
