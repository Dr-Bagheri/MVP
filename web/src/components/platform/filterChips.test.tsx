import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_TRACK, FilterChips, MenuCheck, MenuRadio, SectionTabs, TAB_TRACK, Toolbar, ToolbarMenu,
  filterChipClass, sectionTabClass, toggleClass,
} from "./sectionTabs";

/**
 * THE TOOLBAR IS DESIGN «ج» (the user's choice, 2026-09-17, from three
 * compact designs drawn against the toolbar of the day): a SEGMENTED CONTROL
 * for the views, the sort and the filters behind two MENU buttons with a
 * count of the filters that are on, and the folders as one LINE of chips.
 *
 * These assertions hold the kit to that shape — and to the ABSENCE of the
 * shape it replaced, because the 2026-09-15 toolbar (two rails, one
 * geometry, two colours) renders perfectly and is only wrong beside the
 * design that was chosen over it.
 */
describe("the toolbar kit", () => {
  it("row one is a segmented control: the recessed track, 3px around the pills, the chosen one lifted", () => {
    expect(TAB_TRACK).toContain("bg-surface-2");
    expect(TAB_TRACK).toContain("p-[3px]");
    expect(TAB_TRACK).toContain("rounded-md");
    /* the pill is the fourth size of the button family — the icon height as
       a text button — never a height written beside `btn` */
    expect(sectionTabClass(true)).toMatch(/\bbtn btn-xs\b/);
    expect(sectionTabClass(true)).not.toMatch(/(?<![\w-])(?:min-)?h-/);
    expect(sectionTabClass(true)).toContain("bg-surface");
    expect(sectionTabClass(true)).toContain("shadow-card");
    expect(sectionTabClass(true)).toContain("text-fg");
    expect(sectionTabClass(false)).not.toContain("shadow-card");
    expect(sectionTabClass(false)).not.toContain("bg-surface");
  });

  it("row two is a LINE of chips — no rail under them — and the chip is outlined, accent when on", () => {
    /* no ground and no padding: the row costs what a line of text does */
    expect(FILTER_TRACK).not.toMatch(/\bbg-/);
    expect(FILTER_TRACK).not.toMatch(/(?<![\w-])p-/);
    expect(FILTER_TRACK).not.toMatch(/\brounded-/);
    /* the chip is one class in globals.css, with one coat for "on" */
    expect(filterChipClass(false)).toBe("chip");
    expect(filterChipClass(true)).toBe("chip chip-on");
    /* and it is not a button of the family: a chip shows a state, a button
       does an act */
    expect(filterChipClass(true)).not.toMatch(/\bbtn\b/);
  });

  it("the two rows are two shapes — the 2026-09-15 'one geometry in two colours' is gone", () => {
    /* the reversal, asserted: a kit that put the tinted rail back under the
       chips would satisfy every presence check above and be the toolbar the
       user chose «ج» over */
    expect(FILTER_TRACK).not.toContain("bg-accent-soft");
    expect(TAB_TRACK).not.toBe(FILTER_TRACK);
    expect(filterChipClass(true)).not.toContain("shadow-card");
    /* and row one never wears the retired filled tab */
    for (const cls of [sectionTabClass(true), toggleClass(true)]) {
      expect(cls).not.toMatch(/\bbg-accent\b(?!-soft)/);
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

  it("draws the icon, the label and the count, names the value, and sits in its line", () => {
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

  /**
   * THE MENU: a ghost button at the control's height whose panel holds the
   * two kinds of row, and whose badge counts what is ON inside. The badge is
   * the load-bearing half — a filter behind a closed menu is invisible, and
   * the count is what keeps a filtered list from reading as the whole list.
   */
  it("ToolbarMenu counts the filters that are on, names its value, and its rows answer 'which' and 'on/off'", async () => {
    const onSort = vi.fn();
    const onMine = vi.fn();
    const { rerender } = render(
      <ToolbarMenu label="فیلتر" count={0}>
        <MenuRadio label="اولویت" value="all" onChange={onSort}
          options={[{ key: "all", label: "همه" }, { key: "high", label: "زیاد" }]} />
        <MenuCheck checked={false} onChange={onMine}>فقط من</MenuCheck>
      </ToolbarMenu>,
    );
    const trigger = screen.getByRole("button", { name: /فیلتر/ });
    /* the control's own height, the ghost coat — one of the row's controls */
    expect(trigger.className).toMatch(/\bbtn-ghost\b/);
    expect(trigger.className).toMatch(/\bbtn-sm\b/);
    /* no badge while nothing is on */
    expect(trigger.textContent).not.toMatch(/[0-9۰-۹]/);

    await userEvent.click(trigger);
    const high = await screen.findByRole("menuitemradio", { name: "زیاد" });
    expect(high.getAttribute("data-key")).toBe("high");
    expect(screen.getByRole("menuitemradio", { name: "همه" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(high);
    expect(onSort).toHaveBeenCalledWith("high");

    /* a check row toggles and KEEPS the menu open: two filters are one visit */
    await userEvent.click(screen.getByRole("button", { name: /فیلتر/ }));
    const mine = await screen.findByRole("menuitemcheckbox", { name: "فقط من" });
    await userEvent.click(mine);
    expect(onMine).toHaveBeenCalledWith(true);
    expect(screen.getByRole("menuitemcheckbox", { name: "فقط من" })).toBeInTheDocument();

    /* the count lands on the trigger, in the page's digits, and the value
       after the label */
    rerender(
      <ToolbarMenu label="فیلتر" count={2} value="زیاد">
        <MenuCheck checked onChange={onMine}>فقط من</MenuCheck>
      </ToolbarMenu>,
    );
    const counted = screen.getByRole("button", { name: /فیلتر/ });
    expect(counted.textContent).toContain("۲");
    expect(counted.textContent).toContain("زیاد");
  });
});
