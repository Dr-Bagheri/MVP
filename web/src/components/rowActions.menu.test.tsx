import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KebabMenu, type KebabItem } from "./rowActions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

/**
 * The two theme rules the 2026-08-26 directive put on every kebab in the
 * product: an icon on every row, and the red ones together at the bottom.
 *
 * Both are enforced in `rowActions` rather than at the call sites, so these
 * assertions are about the MENU, not about any one screen — a new menu
 * written tomorrow inherits them without anyone remembering.
 */

const dot = <svg data-testid="glyph" />;

function open(items: KebabItem[]) {
  render(<KebabMenu label="menu" items={items} />);
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  return screen.getAllByRole("menuitem");
}

describe("every kebab item has an icon gutter", () => {
  it("renders the glyph an item supplies", () => {
    open([{ key: "a", label: "Edit", icon: dot }]);
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("still spends the gutter for a row that declined one", () => {
    /**
     * `icon: null` is the deliberate escape hatch for a VALUE row (a size,
     * a playback speed). It must still occupy the column: a label that
     * starts four pixels left of every other label reads as a rendering
     * fault, which is the thing the directive is actually about.
     */
    const [item] = open([{ key: "a", label: "1.5×", icon: null }]);
    const gutter = item!.firstElementChild;
    expect(gutter).not.toBeNull();
    expect(gutter!.className).toContain("w-4");
    expect(gutter!.textContent).toBe("");
  });
});

describe("the danger group", () => {
  it("sorts red items to the END, whatever order the caller listed them", () => {
    const items = open([
      { key: "del", label: "Delete", icon: dot, danger: true },
      { key: "edit", label: "Edit", icon: dot },
      { key: "voice", label: "Remove voice", icon: dot, danger: true },
      { key: "merge", label: "Merge", icon: dot },
    ]);
    // both reds land at the end, in the order the CALLER wrote them —
    // sorting them among themselves would rearrange menus for no reason
    expect(items.map((el) => el.textContent)).toEqual([
      "Edit", "Merge", "Delete", "Remove voice",
    ]);
  });

  it("keeps the caller's order INSIDE each group", () => {
    // the sort is by danger only — it must not also reorder the safe rows,
    // which would silently rearrange every menu in the product
    const items = open([
      { key: "b", label: "B", icon: dot },
      { key: "a", label: "A", icon: dot },
      { key: "z", label: "Z", icon: dot, danger: true },
      { key: "y", label: "Y", icon: dot, danger: true },
    ]);
    expect(items.map((el) => el.textContent)).toEqual(["B", "A", "Z", "Y"]);
  });

  it("rules a line above the red group", () => {
    open([
      { key: "edit", label: "Edit", icon: dot },
      { key: "del", label: "Delete", icon: dot, danger: true },
    ]);
    expect(document.querySelectorAll("[role='menu'] hr")).toHaveLength(1);
  });

  it("draws NO line when there is nothing to separate", () => {
    // an all-red menu, and an all-safe menu, both get a bare list — a rule
    // above the first row is a line under the menu's own top edge
    open([{ key: "del", label: "Delete", icon: dot, danger: true }]);
    expect(document.querySelectorAll("[role='menu'] hr")).toHaveLength(0);
  });
});
