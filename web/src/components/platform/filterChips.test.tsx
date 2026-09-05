import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterChips, filterChipClass, sectionTabClass } from "./sectionTabs";

/**
 * R3, row two (user ruling 2026-09-05): the second sub-menu is the filter
 * chip — outlined, an icon, a label, a count, soft-filled in the accent when
 * active — and it is one class. These assert the class against the string
 * the tasks and meetings strips had been spelling by hand (so a "nicer"
 * rewording here would break the strips' identity), that a row-two chip is
 * NOT the row-one tab, and that the component draws every part.
 */
describe("filter chips", () => {
  it("is the folder strips' chip, character for character, in both states", () => {
    expect(filterChipClass(true)).toBe(
      "btn btn-sm gap-1.5 border font-medium border-accent bg-accent-soft font-semibold text-accent",
    );
    expect(filterChipClass(false)).toBe(
      "btn btn-sm gap-1.5 border font-medium border-border text-fg-muted hover:text-fg",
    );
  });

  it("row two is not row one: the tab fills, the chip outlines", () => {
    expect(sectionTabClass(true)).toContain("bg-accent ");
    expect(sectionTabClass(true)).not.toContain("border-accent");
    expect(filterChipClass(true)).toContain("border-accent");
    expect(filterChipClass(true)).not.toMatch(/\bbg-accent\b(?!-soft)/);
  });

  it("draws the icon, the label and the count, and names the value for a test", () => {
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
    const all = screen.getByRole("tab", { name: /همه/ });
    expect(all.getAttribute("data-key")).toBe("all");
    expect(all.getAttribute("aria-selected")).toBe("false");
    expect(all.className).toBe(filterChipClass(false));
    expect(screen.getByTestId("icon-all")).toBeInTheDocument();
    expect(all.textContent).toContain("۳");
    const online = screen.getByRole("tab", { name: /آنلاین/ });
    expect(online.getAttribute("aria-selected")).toBe("true");
    expect(online.className).toBe(filterChipClass(true));
    /* the row's own extra control renders after the chips */
    expect(screen.getByTestId("extra")).toBeInTheDocument();
  });
});
