import { act, cleanup, render } from "@testing-library/react";
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

/** the engine, replaced by the one thing it does for React: render each tile */
vi.mock("./dashboard/WidgetBoard", () => ({
  WidgetBoard: ({
    layout,
    renderTile,
  }: {
    layout: { tiles: { key: string }[] };
    renderTile: (key: string) => React.ReactNode;
  }) => <div>{layout.tiles.map((tile) => <div key={tile.key}>{renderTile(tile.key)}</div>)}</div>,
}));

vi.mock("@/api/client", () => ({
  api: {
    me: async () => null,
    members: async () => [],
    listCalls: async () => [],
    connectors: async () => [],
    connectorItems: async () => [],
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
    const cards = document.querySelectorAll("section.tile");
    expect(cards).toHaveLength(DEFAULT_WIDGETS.length);

    /*
     * And each one has a BODY. A case missing from `renderBody` returns null,
     * which renders as a titled card with an empty div under it — so the
     * check is for a rendered ELEMENT, not for text: the record tile is a row
     * of icon buttons and has no words in it at all.
     */
    for (const card of Array.from(cards)) {
      const body = card.lastElementChild!;
      expect(body.childElementCount, card.getAttribute("aria-label") ?? "").toBeGreaterThan(0);
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
