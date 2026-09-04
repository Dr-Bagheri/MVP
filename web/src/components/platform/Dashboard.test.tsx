import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WIDGETS, defaultLayout, writeLayout } from "@/lib/dashboardLayout";

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
const boardProps: { locked?: boolean; layout?: { tiles: { key: string }[] } } = {};
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
    boardProps.layout = layout;
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

  it("has no edit mode at all — one arrangement, the same for everybody", async () => {
    /*
     * User directive, 2026-09-04: "remove the edit from the dashboard and fix
     * the positions for all items in the dashboard for all users for now."
     *
     * Asserted as an ABSENCE, because the version that still offers Edit looks
     * completely fine — it is only wrong beside the words "for all users". The
     * two tests this replaces drove the pins and the remove buttons THROUGH
     * that button, so they described a mode rather than the board.
     *
     * The board stays LOCKED, which is the half that matters: without it a
     * drag could still rearrange what everyone is meant to be seeing, and no
     * button would have to exist for that to happen.
     */
    await act(async () => { render(<Dashboard />); });
    expect(screen.queryByText("ویرایش"), "the board still offers an edit mode").toBeNull();
    expect(screen.queryByText("ذخیره")).toBeNull();
    expect(boardProps.locked, "the board can still be rearranged by a drag").toBe(true);
    /* and none of the arranging controls are on screen either */
    expect(screen.queryAllByTitle("سنجاق کردن")).toHaveLength(0);
    expect(screen.queryAllByTitle("برداشتن از تخته")).toHaveLength(0);
  });

  it("shows the shipped arrangement, not one a device remembered", async () => {
    /*
     * The control for "the same for everybody". A stored layout from before
     * the directive must not outlive it — and this is the assertion that
     * fails if the component goes back to reading the store, which is the
     * one edit that would silently undo the directive.
     */
    /* the stored layout is BUILT FROM THE PRODUCER — one tile of the real
       board rather than an object assembled here from memory of its shape,
       which is how the first draft of this line invented three fields the
       type does not have and one value the union does not allow */
    const shipped = defaultLayout();
    writeLayout({ ...shipped, tiles: shipped.tiles.slice(0, 1) });

    await act(async () => { render(<Dashboard />); });
    expect(boardProps.layout?.tiles).toHaveLength(shipped.tiles.length);
    /* and the shipped board is more than one tile, so the assertion above is
       not satisfied by the single remembered one */
    expect(shipped.tiles.length, "the default board cannot tell the two apart").toBeGreaterThan(1);
  });
});
