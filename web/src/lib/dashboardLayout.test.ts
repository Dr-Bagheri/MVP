import { describe, expect, it } from "vitest";
import {
  COLUMNS, SIZE_SPAN, TILE_SIZES, WIDGET_SPECS,
  clampSize, defaultLayout, defaultSizeFor, isPersistableChange, nextFreeSpot, readLayout,
  rowsFor, sizeFromSpan, specFor, writeLayout,
  type TilePlacement,
} from "./dashboardLayout";

/**
 * The registry is the dashboard's structure, so most of what matters is a
 * claim about the CATALOGUE rather than about any one widget: that every
 * entry is internally consistent, and that a stored board can never make
 * the renderer render something impossible.
 */

describe("the widget catalogue", () => {
  it("gives every widget at least one size it is designed at", () => {
    for (const spec of WIDGET_SPECS) {
      expect(spec.sizes.length, spec.key).toBeGreaterThan(0);
    }
  });

  it("never defaults a widget to a size it does not support", () => {
    // the default and the allow-list are two lists that must agree; a
    // default outside its own list renders a tile at a tier nobody designed
    for (const spec of WIDGET_SPECS) {
      expect(spec.sizes, spec.key).toContain(spec.defaultSize);
    }
  });

  it("has no duplicate keys", () => {
    const keys = WIDGET_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("answers with undefined for a key it does not know", () => {
    // a stored layout naming a retired widget must resolve to "nothing to
    // render", never to a crash
    expect(specFor("a-widget-that-was-deleted")).toBeUndefined();
  });
});

describe("sizes", () => {
  /*
   * The subject is FOUND, not named: a test that hardcoded one widget's key
   * broke every time the catalogue changed, while the rule it protects had
   * not moved. What it needs is any widget that does not offer the top
   * tier — and the assertion below fails loudly if the catalogue ever stops
   * containing one, which is itself worth knowing.
   *
   * Read through `specFor`, the accessor the app itself uses: the
   * catalogue's own `as const` narrows `sizes` to a tuple of literals per
   * entry, which makes asking an entry about a tier it does not have a
   * compile error rather than the question this test needs to ask.
   */
  const narrow = WIDGET_SPECS.find((spec) => !specFor(spec.key)!.sizes.includes("hero"));

  it("has a widget that is not designed at every tier", () => {
    expect(narrow, "no widget declines a tier — the clamp is untestable").toBeDefined();
  });

  it("clamps a size the widget no longer supports", () => {
    // a board saved when this widget also had a hero tier must not
    // resurrect as a hero-sized card at a tier nobody designed
    expect(specFor(narrow!.key)!.sizes).not.toContain("hero");
    expect(clampSize(narrow!.key, "hero")).toBe(defaultSizeFor(narrow!.key));
  });

  it("honours a size the widget DOES support", () => {
    const size = specFor(narrow!.key)!.sizes[0]!;
    expect(clampSize(narrow!.key, size)).toBe(size);
  });

  it("keeps every tier inside the grid", () => {
    for (const size of TILE_SIZES) {
      expect(SIZE_SPAN[size].w).toBeGreaterThan(0);
      expect(SIZE_SPAN[size].w).toBeLessThanOrEqual(COLUMNS);
    }
  });

  it("snaps a dragged span back to the nearest tier", () => {
    // the resize handle is continuous; the sizes are not. Every exact span
    // must round-trip, and an in-between drag must land on a real tier.
    for (const size of TILE_SIZES) {
      const span = SIZE_SPAN[size];
      expect(sizeFromSpan(span.w, span.h), size).toBe(size);
    }
    expect(TILE_SIZES).toContain(sizeFromSpan(5, 3));
    expect(TILE_SIZES).toContain(sizeFromSpan(11, 1));
  });

  it("is ADDITIVE: a bigger tier never shows FEWER rows", () => {
    /**
     * The whole law of the four sizes in one assertion. A ladder that
     * dipped anywhere would mean growing a tile could hide a row, which is
     * the one thing resizing must never do.
     */
    const ladder = TILE_SIZES.map(rowsFor);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, TILE_SIZES[i]).toBeGreaterThanOrEqual(ladder[i - 1]!);
    }
  });
});

describe("the default board", () => {
  it("places every default widget inside the grid, without overlaps", () => {
    const { tiles } = defaultLayout();
    expect(tiles.length).toBeGreaterThan(0);
    const cells = new Set<string>();
    for (const tile of tiles) {
      const span = SIZE_SPAN[tile.size];
      expect(tile.x + span.w, tile.key).toBeLessThanOrEqual(COLUMNS);
      for (let x = tile.x; x < tile.x + span.w; x += 1) {
        for (let y = tile.y; y < tile.y + span.h; y += 1) {
          const cell = `${x}:${y}`;
          expect(cells.has(cell), `${tile.key} overlaps at ${cell}`).toBe(false);
          cells.add(cell);
        }
      }
    }
  });
});

describe("adding a card", () => {
  it("puts it BELOW everything already placed", () => {
    // never on top of an existing tile: the engine would then shove a card
    // the person had positioned on purpose
    const tiles: TilePlacement[] = [
      { key: "records", x: 0, y: 0, size: "hero" },
      { key: "agents", x: 0, y: SIZE_SPAN.hero.h, size: "large" },
    ];
    /*
     * DERIVED, not written down. The first version of this asserted a
     * literal 8, which was a fact about the span table wearing the costume
     * of a fact about the rule — it broke the moment a tier's height
     * changed, while the rule it was meant to protect had not moved.
     */
    const bottom = Math.max(...tiles.map((t) => t.y + SIZE_SPAN[t.size].h));
    expect(nextFreeSpot(tiles)).toEqual({ x: 0, y: bottom });
    /* and the property itself: strictly below every placed tile */
    for (const tile of tiles) {
      expect(nextFreeSpot(tiles).y).toBeGreaterThanOrEqual(tile.y + SIZE_SPAN[tile.size].h);
    }
  });

  it("starts at the origin on an empty board", () => {
    expect(nextFreeSpot([])).toEqual({ x: 0, y: 0 });
  });
});

describe("what counts as a change worth storing", () => {
  /**
   * The board came back rearranged after every reload until this rule
   * existed, and BOTH halves of it are load-bearing — which is why all four
   * combinations are here rather than the one that happened to break.
   *
   * The one that did break is the third: gridstack re-lays the board out
   * under a narrower window and reports the result as a change. Written
   * down, that six-column arrangement replaces the twelve-column one, and a
   * full-width card comes back a tier smaller.
   */
  it("stores only a person's change, at the board's own width", () => {
    expect(isPersistableChange({ locked: false, columns: COLUMNS })).toBe(true);
    // locked: nothing a person did can have moved a card
    expect(isPersistableChange({ locked: true, columns: COLUMNS })).toBe(false);
    // narrower: the engine describing this viewport, not an arrangement
    expect(isPersistableChange({ locked: false, columns: 6 })).toBe(false);
    expect(isPersistableChange({ locked: true, columns: 1 })).toBe(false);
  });
});

describe("the stored board", () => {
  it("keeps a pin through a round trip", () => {
    /* a pin is a decision a person made about one card; losing it on reload
       is the same class of bug as losing the arrangement */
    const layout = defaultLayout();
    const first = layout.tiles[0]!;
    writeLayout({ ...layout, tiles: [{ ...first, pinned: true }, ...layout.tiles.slice(1)] });

    const read = readLayout();
    expect(read.tiles.find((tile) => tile.key === first.key)?.pinned).toBe(true);
    // and the control: an unpinned card does not come back pinned
    expect(read.tiles.find((tile) => tile.key !== first.key)?.pinned).toBeUndefined();
  });
});
