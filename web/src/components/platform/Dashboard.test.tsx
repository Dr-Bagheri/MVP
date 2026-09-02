import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WIDGETS } from "@/lib/dashboardLayout";

/**
 * THE BOARD, as an artifact.
 *
 * Two claims that only the rendered page can settle:
 *
 *   1. every widget in the catalogue reaches the screen. A registry entry
 *      with no case in `renderBody` draws a titled card with an empty body —
 *      which looks like a tile that has nothing to say rather than like a
 *      wiring fault, so nothing on the page reports it.
 *   2. no tile paints a COLOUR family (user directive, 2026-08-29: "get rid
 *      of the colors"). The gradients were classes, and a class is exactly
 *      the kind of thing that comes back one entry at a time.
 *
 * The engine is stubbed: gridstack owns geometry, React owns content, and
 * this is a test about content. What it must NOT stub is the tile chrome —
 * the class list is the subject of the second claim.
 */

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));

/**
 * The engine, replaced by the one thing it does for React: render each tile.
 *
 * `lockedProp` is captured rather than asserted through a rendered class,
 * because the class belongs to the real WidgetBoard — asserting it against
 * this stub would be asserting the stub. What the Dashboard is responsible
 * for is the PROP, and that is the seam this file can honestly check.
 */
const boardProps: { locked?: boolean } = {};
vi.mock("./dashboard/WidgetBoard", () => ({
  WidgetBoard: ({
    layout,
    locked,
    renderTile,
  }: {
    layout: { tiles: { key: string }[] };
    locked?: boolean;
    renderTile: (key: string) => React.ReactNode;
  }) => {
    boardProps.locked = locked;
    return <div>{layout.tiles.map((tile) => <div key={tile.key}>{renderTile(tile.key)}</div>)}</div>;
  },
}));

vi.mock("@/api/client", () => ({
  api: {
    me: async () => null,
    members: async () => [],
    listCalls: async () => [],
    connectors: async () => [],
    connectorItems: async () => [],
    meetings: async () => [],
    taskBoard: async () => ({ columns: [], topics: [], tasks: [] }),
    agents: async () => [],
    workflows: async () => [],
  },
}));

const { Dashboard } = await import("./Dashboard");

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the dashboard board", () => {
  it("renders a card for every widget on the default board", async () => {
    await act(async () => { render(<Dashboard />); });

    /*
     * The expected list is DERIVED from the catalogue rather than written
     * out: a hand-written list of seven titles would keep passing while an
     * eighth widget shipped with no renderer, which is the failure this
     * exists for.
     */
    /* by the BOARD's own marker, not by the card class: a widget may render
       bare (the stats strip brings its own four cards, and a titled tile
       around them is a card inside a card). Counting `.tile` counted the
       chrome rather than the widgets, and went one short the day one of them
       stopped wearing it — while every widget was still on the board. */
    const cards = document.querySelectorAll("section[aria-label]");
    expect(cards).toHaveLength(DEFAULT_WIDGETS.length);

    /*
     * And each one has a BODY. A case missing from `renderBody` returns null,
     * which renders as a titled card with an empty div under it — so the
     * check is for a rendered ELEMENT, not for text: the record tile is a row
     * of icon buttons and has no words in it at all.
     */
    for (const card of Array.from(cards)) {
      expect(card.childElementCount, card.getAttribute("aria-label") ?? "").toBeGreaterThan(0);
    }
  });

  it("paints no colour family on any tile", async () => {
    await act(async () => { render(<Dashboard />); });

    const cards = Array.from(document.querySelectorAll("section.tile"));
    /* the guard against a vacuous pass: "no card wears a gradient" is true
       of a page with no cards */
    expect(cards.length).toBeGreaterThan(0);

    const RETIRED = ["tile-feature", "tile-warm", "tile-cool", "tile-tinted", "on-gradient"];
    for (const card of cards) {
      for (const family of RETIRED) {
        expect(card.classList.contains(family), `${card.getAttribute("aria-label")} wears ${family}`)
          .toBe(false);
      }
    }
  });
});

describe("reading, or arranging", () => {
  /**
   * The board is LOCKED until somebody presses Edit (user directive,
   * 2026-08-29). The assertions are paired on purpose: "there is no pin" is
   * satisfied by a board that never renders one, so each case checks what is
   * absent in the one mode AND present in the other.
   */
  it("offers no way to rearrange until Edit is pressed", async () => {
    await act(async () => { render(<Dashboard />); });

    expect(screen.queryAllByTitle("سنجاق کردن")).toHaveLength(0);
    expect(screen.queryAllByTitle("برداشتن از تخته")).toHaveLength(0);
    expect(screen.queryByText("ذخیره")).toBeNull();
    // and the engine is told: the cursor and the grips are downstream of this
    expect(boardProps.locked).toBe(true);
  });

  it("shows the pins and the remove buttons while editing, and locks again on Save", async () => {
    await act(async () => { render(<Dashboard />); });

    await act(async () => { fireEvent.click(screen.getByText("ویرایش")); });
    const tiles = document.querySelectorAll("section.tile").length;
    expect(screen.getAllByTitle("سنجاق کردن")).toHaveLength(tiles);
    expect(screen.getAllByTitle("برداشتن از تخته")).toHaveLength(tiles);
    expect(boardProps.locked).toBe(false);

    await act(async () => { fireEvent.click(screen.getByText("ذخیره")); });
    expect(screen.queryAllByTitle("سنجاق کردن")).toHaveLength(0);
    expect(boardProps.locked).toBe(true);
  });

  it("pins one card without pinning the rest", async () => {
    await act(async () => { render(<Dashboard />); });
    await act(async () => { fireEvent.click(screen.getByText("ویرایش")); });

    const pins = screen.getAllByTitle("سنجاق کردن");
    await act(async () => { fireEvent.click(pins[0]!); });

    /* exactly one — a toggle that pinned everything would satisfy any
       "is it pinned" assertion just as happily */
    expect(screen.getAllByTitle("برداشتن سنجاق")).toHaveLength(1);
    expect(screen.getAllByTitle("سنجاق کردن")).toHaveLength(pins.length - 1);
  });
});
