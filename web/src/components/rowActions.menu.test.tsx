import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KebabMenu, SelectMenu, type KebabItem } from "./rowActions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fa",
}));

/*
 * DRIVEN WITH `userEvent`, not `fireEvent.click`. The menu opens on
 * POINTERDOWN — a real press always sends one, and fireEvent.click sends
 * only the click, so the menu never opened and every assertion below failed
 * for a reason that had nothing to do with the product.
 */
/**
 * The two theme rules the 2026-08-26 directive put on every kebab in the
 * product: an icon on every row, and the red ones together at the bottom.
 *
 * Both are enforced in `rowActions` rather than at the call sites, so these
 * assertions are about the MENU, not about any one screen — a new menu
 * written tomorrow inherits them without anyone remembering.
 */

const dot = <svg data-testid="glyph" />;

async function open(items: KebabItem[]) {
  render(<KebabMenu label="menu" items={items} />);
  await userEvent.click(screen.getByRole("button", { name: "menu" }));
  return screen.getAllByRole("menuitem");
}

describe("every kebab item has an icon gutter", () => {
  it("renders the glyph an item supplies", async () => {
    await open([{ key: "a", label: "Edit", icon: dot }]);
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("still spends the gutter for a row that declined one", async () => {
    /**
     * `icon: null` is the deliberate escape hatch for a VALUE row (a size,
     * a playback speed). It must still occupy the column: a label that
     * starts four pixels left of every other label reads as a rendering
     * fault, which is the thing the directive is actually about.
     */
    const [item] = await open([{ key: "a", label: "1.5×", icon: null }]);
    const gutter = item!.firstElementChild;
    expect(gutter).not.toBeNull();
    expect(gutter!.className).toContain("w-4");
    expect(gutter!.textContent).toBe("");
  });
});

describe("the danger group", () => {
  it("sorts red items to the END, whatever order the caller listed them", async () => {
    const items = await open([
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

  it("keeps the caller's order INSIDE each group", async () => {
    // the sort is by danger only — it must not also reorder the safe rows,
    // which would silently rearrange every menu in the product
    const items = await open([
      { key: "b", label: "B", icon: dot },
      { key: "a", label: "A", icon: dot },
      { key: "z", label: "Z", icon: dot, danger: true },
      { key: "y", label: "Y", icon: dot, danger: true },
    ]);
    expect(items.map((el) => el.textContent)).toEqual(["B", "A", "Z", "Y"]);
  });

  it("rules a line above the red group", async () => {
    await open([
      { key: "edit", label: "Edit", icon: dot },
      { key: "del", label: "Delete", icon: dot, danger: true },
    ]);
    /* by ROLE, not by tag: the rule is "a line separates the red group",
       and `role="separator"` is the half a screen reader gets. An assertion
       on `hr` was really an assertion about which element we happened to
       reach for, and it went red on a swap that changed nothing a user
       could see. */
    expect(document.querySelectorAll("[role='menu'] [role='separator']")).toHaveLength(1);
  });

  it("draws NO line when there is nothing to separate", async () => {
    // an all-red menu, and an all-safe menu, both get a bare list — a rule
    // above the first row is a line under the menu's own top edge
    await open([{ key: "del", label: "Delete", icon: dot, danger: true }]);
    expect(document.querySelectorAll("[role='menu'] [role='separator']")).toHaveLength(0);
  });
});

/**
 * The TILE face (user directive, 2026-08-26: "big buttons with icons inside
 * that have an arrow down"). Its defining property is what the button does
 * NOT contain: the chosen value lives in a caption under the button and in
 * the panel's checked row, never inside the glyph button. The third test is
 * the discriminating control — the same value that must be absent from a
 * tile trigger must be PRESENT in an input trigger, so a regression that
 * collapses the two faces into either one fails one of the pair.
 */
function renderTile() {
  render(
    <SelectMenu
      variant="tile"
      ariaLabel="Microphone"
      panelHeading="Microphone"
      icon={<svg data-testid="tile-glyph" />}
      value="a"
      onChange={() => {}}
      options={[
        { value: "a", label: "Default mic" },
        { value: "b", label: "USB mic" },
      ]}
    />,
  );
}

describe("the SelectMenu tile face", () => {
  it("keeps the value OUT of the button — glyph only, caption below", async () => {
    renderTile();
    const btn = screen.getByRole("button", { name: /Microphone/ });
    expect(btn.textContent).not.toContain("Default mic");
    expect(btn.querySelector("[data-testid='tile-glyph']")).not.toBeNull();
    expect(screen.getByTitle("Default mic").textContent).toBe("Default mic");
  });

  it("names the open panel with its heading and checks only the chosen row", async () => {
    renderTile();
    fireEvent.click(screen.getByRole("button", { name: /Microphone/ }));
    // the tile shows no field name, so the panel must say what is picked
    expect(screen.getByRole("listbox").textContent).toContain("Microphone");
    const chosen = screen.getByRole("option", { name: "Default mic" });
    expect(chosen.getAttribute("aria-selected")).toBe("true");
    expect(chosen.textContent).toContain("✓");
    // negative control: the mark distinguishes, it does not decorate
    expect(screen.getByRole("option", { name: "USB mic" }).textContent).not.toContain("✓");
  });

  it("the INPUT face still carries its value inside the trigger", async () => {
    render(
      <SelectMenu
        ariaLabel="Language"
        value="fa"
        onChange={() => {}}
        options={[{ value: "fa", label: "Persian" }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Language" }).textContent).toContain("Persian");
  });
});

/**
 * Hover-open (user directive, 2026-08-26: "come out without click just by
 * mouse hover and disappear when it passes") — tile face only. The grace
 * window matters: the panel sits a few pixels below the button, and a
 * close that fires the instant the pointer leaves the button makes the
 * panel unreachable. The input-face test is the negative control: a form
 * select opening under a passing pointer would be a regression, not a
 * feature spreading.
 */
/**
 * The nested flyout (`sub`). It has carried the export menu and the
 * dashboard's add-widget menu since 2026-08-25 with no test at all — and
 * the recorder's settings gear now depends on it for every device,
 * language, template and model choice, so it gets one.
 */
describe("the sub-menu flyout", () => {
  it("a sub row opens its flyout instead of acting", async () => {
    const onParent = vi.fn();
    const onChild = vi.fn();
    render(
      <KebabMenu
        label="menu"
        items={[{
          key: "lang",
          label: "Language",
          icon: dot,
          onSelect: onParent,
          sub: [{ key: "fa", label: "Persian", icon: null, onSelect: onChild }],
        }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "menu" }));
    // the child is not rendered until its parent row is pressed
    expect(screen.queryByRole("menuitem", { name: "Persian" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: /Language/ }));
    expect(screen.getByRole("menuitem", { name: "Persian" })).toBeTruthy();
    // pressing a row that OWNS a flyout must not also fire its own action
    expect(onParent).not.toHaveBeenCalled();
  });

  it("choosing inside the flyout acts and closes everything", async () => {
    const onChild = vi.fn();
    render(
      <KebabMenu
        label="menu"
        items={[{
          key: "lang",
          label: "Language",
          icon: dot,
          sub: [{ key: "fa", label: "Persian", icon: null, onSelect: onChild }],
        }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Language/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Persian" }));
    expect(onChild).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the tile face opens on hover", () => {
  it("opens on enter, closes after the pointer has passed", async () => {
    vi.useFakeTimers();
    try {
      renderTile();
      const btn = screen.getByRole("button", { name: /Microphone/ });
      fireEvent.mouseEnter(btn);
      expect(screen.getByRole("listbox")).toBeTruthy();
      fireEvent.mouseLeave(btn);
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByRole("listbox")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives the trip from button to panel", async () => {
    vi.useFakeTimers();
    try {
      renderTile();
      const btn = screen.getByRole("button", { name: /Microphone/ });
      fireEvent.mouseEnter(btn);
      const panel = screen.getByRole("listbox");
      fireEvent.mouseLeave(btn);
      fireEvent.mouseEnter(panel); // within the grace window
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.getByRole("listbox")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the INPUT face never hover-opens", async () => {
    render(
      <SelectMenu
        ariaLabel="Language"
        value="fa"
        onChange={() => {}}
        options={[{ value: "fa", label: "Persian" }]}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Language" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
