"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { GridStack, type GridStackNode } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import {
  COLUMNS, SIZE_SPAN, sizeFromSpan,
  type DashboardLayout, type TilePlacement, type WidgetKey,
} from "@/lib/dashboardLayout";

/**
 * THE BOARD ENGINE — a thin adapter over gridstack.
 *
 * Why an engine at all: free placement needs real collision and reflow
 * maths. A CSS grid can express "these tiles in this order"; it cannot
 * express "this tile stays in the bottom-right corner where I put it, and
 * dragging another one near it pushes that one aside". gridstack is MIT,
 * has zero runtime dependencies, and — the deciding factor for a
 * Persian-first product — handles RTL in the drag and resize COORDINATE
 * MATH, not merely in a stylesheet. Its resize handles invert on RTL and
 * its drag offsets measure from the right edge. The obvious alternative
 * gets the second part wrong: react-grid-layout has an open issue where
 * shrinking a tile in RTL grows it instead.
 *
 * ⚠ THE LANDMINE, handled below: gridstack's `rtl: 'auto'` reads
 * `el.style.direction` — the INLINE style. Next sets `dir` on <html>, so
 * auto-detect resolves to FALSE and you get an LTR grid under perfectly
 * correct Persian text: a silent wrong-direction failure that looks fine
 * until someone drags something. `rtl` is therefore passed EXPLICITLY from
 * the locale, and asserted in the tests.
 *
 * The adapter's contract with React: gridstack owns positions, React owns
 * content. Children are rendered by React into stable wrapper elements;
 * the engine only ever moves those wrappers. Layout changes come back out
 * through `onChange` as plain data, and the parent stores it. No React
 * state drives geometry, so the two never fight over the same DOM.
 */

export interface WidgetBoardProps {
  layout: DashboardLayout;
  /** every change the ENGINE made — drags, resizes, and its own reflow */
  onChange: (tiles: TilePlacement[]) => void;
  /** the tile's content, by key */
  renderTile: (key: WidgetKey) => ReactNode;
  /** locked = no drag, no resize (the narrow-screen and read-only case) */
  locked?: boolean;
}

export function WidgetBoard({ layout, onChange, renderTile, locked = false }: WidgetBoardProps) {
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<GridStack | null>(null);
  /** the latest onChange, so the engine's handler never closes over a stale one */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const rtl = locale === "fa";
  const compact = layout.density === "compact";

  /* ---- create once, per direction/density ------------------------------
     Re-creating on a locale flip is deliberate: `rtl` is a construction
     option, and a grid built LTR cannot be talked into RTL afterwards. */
  useEffect(() => {
    if (!hostRef.current) return;
    const grid = GridStack.init(
      {
        column: COLUMNS,
        cellHeight: compact ? 58 : 74,
        margin: compact ? 5 : 7,
        /* NEVER 'auto' — see the landmine note above */
        rtl,
        /* a home screen does NOT gravity-compact: a tile left low stays
           low. `float: true` is what makes the board feel like a home
           screen rather than a report that reflows under you. */
        float: true,
        animate: true,
        draggable: { handle: ".tile-grip" },
        resizable: { handles: "se, sw" },
        disableDrag: locked,
        disableResize: locked,
        /* the board grows downward; it must never scroll sideways */
        columnOpts: {
          breakpointForWindow: true,
          breakpoints: [
            { w: 700, c: 1 },
            { w: 1100, c: 6 },
            { w: 10000, c: COLUMNS },
          ],
          layout: "move",
        },
      },
      hostRef.current,
    );
    /* `init` is typed as possibly null — it returns nothing when the host
       element has already been initialised. A board that could not be
       created renders as a plain stack of tiles rather than throwing. */
    if (!grid) return;
    gridRef.current = grid;

    const emit = () => {
      const tiles = grid.save(false) as GridStackNode[];
      onChangeRef.current(
        tiles
          .filter((node): node is GridStackNode & { id: string } => typeof node.id === "string")
          .map((node) => ({
            key: node.id as WidgetKey,
            x: node.x ?? 0,
            y: node.y ?? 0,
            /* a drag-resize lands between tiers; it SNAPS to the nearest
               one, so the four sizes stay four sizes however the handle
               was dragged */
            size: sizeFromSpan(node.w ?? 3, node.h ?? 2),
          })),
      );
    };
    grid.on("change", emit);
    grid.on("resizestop", emit);

    return () => {
      grid.off("change");
      grid.off("resizestop");
      grid.destroy(false);
      gridRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry options are construction-time
  }, [rtl, compact, locked]);

  /* ---- reconcile: the engine is told about tiles React has rendered ----
     React puts the wrapper in the DOM; this hands it to the engine, moves
     it if the stored placement changed, and removes it when the card is
     hidden. `batchUpdate` keeps a multi-tile change to one reflow. */
  useEffect(() => {
    const grid = gridRef.current;
    const host = hostRef.current;
    if (grid === null || host === null) return;

    grid.batchUpdate();
    try {
      const wanted = new Map(layout.tiles.map((tile) => [tile.key as string, tile]));

      /* gone: a card the person hid */
      for (const el of Array.from(host.querySelectorAll<HTMLElement>(".grid-stack-item"))) {
        const key = el.getAttribute("gs-id");
        if (key && !wanted.has(key)) grid.removeWidget(el, false);
      }

      /* new or moved */
      for (const tile of layout.tiles) {
        const span = SIZE_SPAN[tile.size];
        const el = host.querySelector<HTMLElement>(`.grid-stack-item[gs-id="${tile.key}"]`);
        if (!el) continue;
        const node = (el as HTMLElement & { gridstackNode?: GridStackNode }).gridstackNode;
        if (!node) {
          grid.makeWidget(el, { id: tile.key, x: tile.x, y: tile.y, w: span.w, h: span.h });
          continue;
        }
        if (node.x !== tile.x || node.y !== tile.y || node.w !== span.w || node.h !== span.h) {
          grid.update(el, { x: tile.x, y: tile.y, w: span.w, h: span.h });
        }
      }
    } finally {
      grid.batchUpdate(false);
    }
  }, [layout.tiles]);

  return (
    <div ref={hostRef} className="grid-stack">
      {layout.tiles.map((tile) => {
        const span = SIZE_SPAN[tile.size];
        return (
          <div
            key={tile.key}
            className="grid-stack-item"
            gs-id={tile.key}
            gs-x={String(tile.x)}
            gs-y={String(tile.y)}
            gs-w={String(span.w)}
            gs-h={String(span.h)}
          >
            <div className="grid-stack-item-content">{renderTile(tile.key)}</div>
          </div>
        );
      })}
    </div>
  );
}
