import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FILTER_TRACK, FilterChips, SectionTabs, TAB_TRACK, Toolbar, filterChipClass, sectionTabClass, toggleClass,
} from "./sectionTabs";

/**
 * THE TWO SUB-MENUS ARE ONE DESIGN IN TWO COLOURS (user ruling, 2026-09-15:
 * "I want them to look like the meeting top menu … and for the second one use
 * a little different colour but same design").
 *
 * The meetings track is the design: a rounded rail on the recessed ground,
 * the chosen entry lifted as a pill in the surface tone with the card shadow.
 * These assertions hold the two rows to that ONE geometry and let them differ
 * only where the ruling lets them — the rail's ground and the chosen pill's
 * ink.
 */
describe("the toolbar kit", () => {
  it("row one is the meetings track: recessed rail, lifted pill, fg ink", () => {
    expect(TAB_TRACK).toContain("rounded-xl");
    expect(TAB_TRACK).toContain("bg-surface-2");
    expect(TAB_TRACK).toContain("p-1");
    expect(sectionTabClass(true)).toContain("bg-surface");
    expect(sectionTabClass(true)).toContain("shadow-card");
    expect(sectionTabClass(true)).toContain("text-fg");
    expect(sectionTabClass(false)).not.toContain("shadow-card");
  });

  it("row two is the SAME track and the SAME pill in another colour", () => {
    /* the geometry: every non-colour token of the rail is shared */
    const geometry = (cls: string) =>
      cls.split(/\s+/).filter((w) => !/^(bg-|text-|shadow-|font-)/.test(w)).sort().join(" ");
    expect(geometry(FILTER_TRACK)).toBe(geometry(TAB_TRACK));
    expect(geometry(filterChipClass(true))).toBe(geometry(sectionTabClass(true)));
    expect(geometry(filterChipClass(false))).toBe(geometry(sectionTabClass(false)));
    /* the colour: the rail is tinted, the chosen pill speaks in the accent */
    expect(FILTER_TRACK).toContain("bg-accent-soft");
    expect(FILTER_TRACK).not.toContain("bg-surface-2");
    expect(filterChipClass(true)).toContain("text-accent");
    expect(sectionTabClass(true)).not.toContain("text-accent");
    /* and the chosen pill is lifted the same way on both rows */
    expect(filterChipClass(true)).toContain("shadow-card");
  });

  it("neither row is the old filled tab or the old outlined chip", () => {
    /* the two recipes this kit retired, asserted as absences because a track
       that put one of them back renders perfectly and is only wrong beside
       the meetings page */
    for (const cls of [sectionTabClass(true), filterChipClass(true), toggleClass(true)]) {
      expect(cls).not.toMatch(/\bbg-accent\b(?!-soft)/);
      expect(cls).not.toContain("border-accent");
      expect(cls).not.toMatch(/(?<![\w-])border(?![\w-])/);
    }
  });

  it("a track never wraps — it scrolls; a row wraps its tracks as units", () => {
    for (const track of [TAB_TRACK, FILTER_TRACK]) {
      expect(track).toContain("overflow-x-auto");
      expect(track).not.toContain("flex-wrap");
      expect(track).toContain("shrink-0");
    }
    expect(sectionTabClass(false)).toContain("shrink-0");
  });

  it("draws the icon, the label and the count, names the value, and sits in its track", () => {
    render(
      <FilterChips
        label="فیلتر"
        active="online"
        onSelect={() => undefined}
        chips={[
          { key: "all", label: "همه", icon: <svg data-testid="icon-all" />, count: "۳" },
          { key: "online", label: "آنلاین", icon: <svg data-testid="icon-online" /> },
        ]}
      >
        <span data-testid="extra">+</span>
      </FilterChips>,
    );
    const list = screen.getByRole("tablist", { name: "فیلتر" });
    expect(list.className).toContain(FILTER_TRACK);
    const all = screen.getByRole("tab", { name: /همه/ });
    expect(all.getAttribute("data-key")).toBe("all");
    expect(all.getAttribute("aria-selected")).toBe("false");
    expect(all.className).toBe(filterChipClass(false));
    expect(screen.getByTestId("icon-all")).toBeInTheDocument();
    expect(all.textContent).toContain("۳");
    const online = screen.getByRole("tab", { name: /آنلاین/ });
    expect(online.getAttribute("aria-selected")).toBe("true");
    expect(online.className).toBe(filterChipClass(true));
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });

  it("SectionTabs sits in row one's track and names its values", () => {
    render(
      <SectionTabs
        label="نما"
        active="list"
        onSelect={() => undefined}
        tabs={[{ key: "board", label: "برد", count: 4 }, { key: "list", label: "لیست" }]}
      />,
    );
    const list = screen.getByRole("tablist", { name: "نما" });
    expect(list.className).toContain(TAB_TRACK);
    const board = screen.getByRole("tab", { name: /برد/ });
    expect(board.getAttribute("data-key")).toBe("board");
    expect(board.className).toBe(sectionTabClass(false));
    expect(board.textContent).toContain("۴");
    expect(screen.getByRole("tab", { name: "لیست" }).className).toBe(sectionTabClass(true));
  });

  it("Toolbar puts the tracks at the start and the actions at the end", () => {
    const { container } = render(
      <Toolbar end={<button type="button">ساختن</button>}>
        <span data-testid="track">track</span>
      </Toolbar>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("justify-between");
    expect(row.children).toHaveLength(2);
    expect(row.children[0]!.contains(screen.getByTestId("track"))).toBe(true);
    expect(row.children[1]!.contains(screen.getByRole("button", { name: "ساختن" }))).toBe(true);
  });
});
