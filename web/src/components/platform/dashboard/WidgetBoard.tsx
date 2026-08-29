"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { GridStack, type GridStackNode } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import {
  COLUMNS, SIZE_SPAN, clampSize, isPersistableChange, sizeFromSpan,
  type DashboardLayout, type TilePlacement, type WidgetKey,
} from "@/lib/dashboardLayout";

/**
 * THE BOARD ENGINE — a thin adapter over gridstack.
 *
 * Why an engine at all: free placement needs real collision and reflow
 * maths. A CSS grid can express "these tiles in this order"; it cannot
 * express "this one stays where I put it, and dragging another one near it
 * pushes that one aside". gridstack is MIT, has zero runtime dependencies,
 * and — the deciding factor for a Persian-first product — handles RTL in
 * the drag and resize COORDINATE MATH, not merely in a stylesheet.
 *
 * ⚠ THE LANDMINE, handled below: gridstack's `rtl: 'auto'` reads
 * `el.style.direction` — the INLINE style. Next sets `dir` on <html>, so
 * auto-detect resolves to FALSE and you get an LTR grid under perfectly
 * correct Persian text. Measured in the running app: the host element's
 * inline direction is empty. `rtl` is passed EXPLICITLY from the locale.
 *
 * The contract with React: gridstack owns positions, React owns content.
 * Children render into stable wrappers; the engine only ever moves those
 * wrappers. Changes come back out through `onChange` as plain data.
 */

export interface WidgetBoardProps {
  layout: DashboardLayout;
  /** every change the ENGINE made — drags, resizes, and its own reflow */
  onChange: (tiles: TilePlacement[]) => void;
  renderTile: (key: WidgetKey) => ReactNode;
  locked?: boolean;
}

/**
 * How long the pointer must rest before the engine resolves a collision.
 *
 * This is the fix for "it pushes everyone away even when it fits". Without
 * a pause, every pixel of a drag re-runs the collision solver, so passing
 * OVER a tile on the way to an empty gap shoves it aside — and the shove is
 * kept. With a pause, the board only rearranges where the pointer actually
 * settles, which is also what makes a press-and-hold read as "pick up".
 */
const COLLIDE_PAUSE_MS = 130;

/** controls inside a tile that must never start a drag */
const NO_DRAG = "input,textarea,button,select,option,a,[role=\"menu\"],[data-nodrag]";

export function WidgetBoard({ layout, onChange, renderTile, locked = false }: WidgetBoardProps) {
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<GridStack | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /**
   * THE FEEDBACK LOOP, and why this ref exists.
   *
   * The engine emits a change → the parent stores it → `layout.tiles`
   * changes → the reconcile effect runs → it calls `grid.update()` on every
   * tile → which re-runs collision → which emits another change. The board
   * fought itself: tiles that had been dropped cleanly ended up shuffled,
   * and gaps appeared that nothing had asked for.
   *
   * A layout change that CAME FROM the engine must not be pushed back into
   * it. The engine already has that state; re-applying it is what scrambles.
   */
  const fromEngine = useRef(false);

  /** the pinned keys, readable from inside the engine's own callbacks */
  const pinnedRef = useRef<Set<string>>(new Set());
  pinnedRef.current = new Set(
    layout.tiles.filter((tile) => tile.pinned === true).map((tile) => tile.key),
  );

  const rtl = locale === "fa";
  const compact = layout.density === "compact";

  /* ---- create once, per direction/density ---------------------------- */
  useEffect(() => {
    if (!hostRef.current) return;
    const grid = GridStack.init(
      {
        column: COLUMNS,
        cellHeight: compact ? 62 : 78,
        margin: compact ? 5 : 7,
        /* NEVER 'auto' — see the landmine note above */
        rtl,
        /* a home screen does NOT gravity-compact: a tile left low stays
           low, and a gap you left is a gap you meant */
        float: true,
        animate: true,
        /**
         * THE WHOLE TILE IS THE HANDLE (user directive): press and hold
         * anywhere on a card to move it. The grip strip is gone. `cancel`
         * is what keeps a card's own controls usable — a click on the menu,
         * a link or an input must not become a drag.
         */
        draggable: {
          handle: ".grid-stack-item-content",
          cancel: NO_DRAG,
          pause: COLLIDE_PAUSE_MS,
        },
        /* both bottom corners: `se` is natural in LTR, `sw` in RTL, and
           offering both means the grip is always on the side the eye
           expects without branching on direction */
        resizable: { handles: "se,sw" },
        alwaysShowResizeHandle: false,
        disableDrag: locked,
        disableResize: locked,
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
    if (!grid) return;
    gridRef.current = grid;

    const emit = () => {
      /*
       * TWO GUARDS, and the board lost its arrangement on every reload
       * without them (user report, 2026-08-29: "when i refreshed they go all
       * around").
       *
       * COLUMN COUNT. `columnOpts` re-lays the board out under a narrower
       * window — twelve columns become six, then one — and rewrites every
       * node's x/y/w to fit. That is the engine describing THIS VIEWPORT,
       * not a person moving a tile; `grid.save()` at six columns reports a
       * `hero` card as six wide, which `sizeFromSpan` reads as `large`. Store
       * it and the arrangement is overwritten by a projection of itself, so
       * the next full-width load restores something nobody ever arranged.
       * The same shape as the RLS counting corollary: "I counted N" and
       * "there are N" are different statements, and this one is "the board
       * looks like this HERE".
       *
       * LOCKED. Outside edit mode nothing a person does can move a card, so
       * any change event is the engine's own reflow — never something to
       * write down.
       */
      if (!isPersistableChange({ locked, columns: grid.getColumn() })) return;
      const nodes = grid.save(false) as GridStackNode[];
      fromEngine.current = true;
      onChangeRef.current(
        nodes
          .filter((node): node is GridStackNode & { id: string } => typeof node.id === "string")
          .map((node) => {
            const key = node.id as WidgetKey;
            return {
              key,
              /* the pin is the PERSON's, not the engine's — it is read back
                 off the layout rather than off the node, so a reflow can
                 never quietly unpin a card */
              ...(pinnedRef.current.has(key) ? { pinned: true as const } : {}),
              x: node.x ?? 0,
              y: node.y ?? 0,
              /**
               * A drag-resize lands between tiers, so it SNAPS to the
               * nearest — and then to one this widget actually supports.
               * Without the clamp a card could be left at a size nobody
               * designed it at, which is how a tile ends up with its
               * content spilling out of the bottom.
               */
              size: clampSize(key, sizeFromSpan(node.w ?? 3, node.h ?? 2)),
            };
          }),
      );
    };
    grid.on("change", emit);
    grid.on("resizestop", emit);
    grid.on("dragstop", emit);

    return () => {
      grid.off("change");
      grid.off("resizestop");
      grid.off("dragstop");
      grid.destroy(false);
      gridRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is construction-time
  }, [rtl, compact, locked]);

  /* ---- reconcile: only for changes React made, never the engine's ---- */
  useEffect(() => {
    if (fromEngine.current) {
      fromEngine.current = false;
      return;
    }
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
        const pinned = tile.pinned === true;
        if (!node) {
          grid.makeWidget(el, {
            id: tile.key, x: tile.x, y: tile.y, w: span.w, h: span.h,
            /* `locked` is gridstack's "cannot be PUSHED by another widget",
               which is the half a pin is actually for; noMove/noResize are
               the half about your own pointer */
            noMove: pinned, noResize: pinned, locked: pinned,
          });
          continue;
        }
        if (node.x !== tile.x || node.y !== tile.y || node.w !== span.w || node.h !== span.h) {
          grid.update(el, { x: tile.x, y: tile.y, w: span.w, h: span.h });
        }
        if (node.noMove !== pinned) {
          grid.update(el, { noMove: pinned, noResize: pinned, locked: pinned });
        }
      }
    } finally {
      grid.batchUpdate(false);
    }
  }, [layout.tiles]);

  return (
    /* the cursor and the resize grips are scoped to this class: a board you
       cannot move should not offer a hand to move it (user directive: "the
       moving hand will disapear") */
    <div ref={hostRef} className={`grid-stack ${locked ? "grid-locked" : "grid-editing"}`}>
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
            /*
             * The pin is rendered as ATTRIBUTES as well as pushed through
             * `grid.update`, and both are needed. Toggling edit mode
             * destroys and re-initialises the engine — it reads the board
             * back off these attributes — while the reconcile effect only
             * runs when `layout.tiles` changes. Without the attributes a pin
             * survived until the moment you pressed Save, which is the one
             * moment it has to survive.
             */
            {...(tile.pinned === true
              ? { "gs-no-move": "true", "gs-no-resize": "true", "gs-locked": "true" }
              : {})}
          >
            <div className="grid-stack-item-content">{renderTile(tile.key)}</div>
          </div>
        );
      })}
    </div>
  );
}
