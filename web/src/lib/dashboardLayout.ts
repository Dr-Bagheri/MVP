"use client";

import { DEFAULT_WIDGETS, WIDGETS, specFor, type WidgetKey } from "@/lib/widgetRegistry";

export type { WidgetKey } from "@/lib/widgetRegistry";
export {
  WIDGETS, DEFAULT_WIDGETS, specFor, WIDGET_SPECS, WIDGET_GROUPS,
} from "@/lib/widgetRegistry";

/**
 * The dashboard's LAYOUT — where each card sits, how big it is, and how
 * dense the board is.
 *
 * A CLOSED SET OF SIZES, NOT FREE RESIZE. Every platform that ships home-screen
 * widgets lands on a small closed set — Windows 11 ships three, Apple's
 * system family is four, Android's quality bar names 2x2/4x1/4x2 as the
 * target set. A closed set is what lets a widget be DESIGNED at each size
 * instead of stretched to fit. The law that comes with it: a bigger tile
 * shows MORE INFORMATION, never the same content scaled up.
 *
 * PLACEMENT IS FREE. Unlike the earlier ordered-list model, a card carries
 * an x/y. A home screen does not gravity-compact — an icon left at the
 * bottom stays at the bottom — and that is only expressible with real
 * coordinates. The grid engine owns collision and reflow; this file owns
 * the shape that gets stored and the rules about what a stored shape may
 * say.
 *
 * INTERIM store: localStorage, per browser, marked as such. A layout is a
 * per-person convenience, not a record — losing it costs a drag, not data.
 * The named upgrade is `app_user.dashboard_layout` (the preferences slot
 * that already carries calendar/timezone), at which point `readLayout` and
 * `writeLayout` swap for the wire and everything below stays.
 */

/**
 * The tiers, on a 12-column grid. Named for what they look like rather than
 * for their span, because the name is what the size menu shows. Twelve
 * columns rather than six so a `small` tile is a genuine quarter and the
 * engine can pack without half-column rounding.
 */
/* ORDER IS THE LADDER: rowsFor must be non-decreasing along this list
   (asserted) — band sits beside wide because it shares wide's height */
export const TILE_SIZES = ["small", "wide", "band", "column", "large", "tall", "hero"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const COLUMNS = 12;

/** columns × rows for each tier; one row is one grid track */
export const SIZE_SPAN: Record<TileSize, { w: number; h: number }> = {
  small: { w: 3, h: 2 },
  wide: { w: 6, h: 2 },
  /* a quarter-width card with room for a real list or a 2x2 grid of cards */
  column: { w: 3, h: 3 },
  large: { w: 6, h: 3 },
  /*
   * BAND is the stat strip's tier (the reference adoption): full width and
   * shallow — a row of four figure cards is wide reading, not tall reading,
   * and at hero height it would carry a third of the card as dead air.
   */
  band: { w: 12, h: 2 },
  /*
   * TALL is the calendar's tier: a month is five or six rows of squares, and
   * squares only stay square if the tile has the height to hold them. It is
   * the one tier taller than it is wide, which is exactly what a month is.
   */
  tall: { w: 3, h: 5 },
  hero: { w: 12, h: 3 },
};

/** the tier a given w/h is closest to — how a drag-resize snaps back */
export function sizeFromSpan(w: number, h: number): TileSize {
  let best: TileSize = "small";
  let bestCost = Infinity;
  for (const size of TILE_SIZES) {
    const span = SIZE_SPAN[size];
    /* height counts for more: two tiers can share a width, and picking the
       wrong height is the change a person actually notices */
    const cost = Math.abs(span.w - w) + Math.abs(span.h - h) * 1.5;
    if (cost < bestCost) {
      bestCost = cost;
      best = size;
    }
  }
  return best;
}

/**
 * How many list rows a tier has room for — the one place the ladder lives,
 * and the reason every list widget can be written without measuring itself.
 * The layout suite asserts it never dips: growing a tile must never hide a
 * row.
 */
export function rowsFor(size: TileSize): number {
  return { small: 3, wide: 3, band: 3, column: 5, large: 6, tall: 9, hero: 12 }[size];
}

export type Density = "comfortable" | "compact";

/** one card's placement — the unit the engine and the store both speak */
export interface TilePlacement {
  key: WidgetKey;
  x: number;
  y: number;
  size: TileSize;
  /**
   * PINNED: this card holds its place even while the board is being edited.
   *
   * The board is locked outside edit mode, so a pin is not what stops a card
   * moving in ordinary use — it is what stops a card being SHOVED by another
   * one you are dragging. Without it, arranging the last tile rearranges the
   * three you had already settled.
   */
  pinned?: boolean;
}

export interface DashboardLayout {
  tiles: TilePlacement[];
  density: Density;
}

/*
 * v3 because the CATALOGUE changed, not because the shape did.
 *
 * A v2 board names widgets that no longer exist, and `readLayout` drops
 * unknown keys one by one — which would leave a person who had arranged the
 * old board with a board of NO tiles. That is a real state here (hiding
 * every card is allowed, and an empty board must survive a reload), so it
 * would be honoured rather than repaired: the dashboard would come back
 * blank for exactly the people who had used it most. A new key means their
 * old arrangement is simply not this board's arrangement, and they get the
 * default one.
 *
 * v4: the reference arrangement (2026-08-31). Same reasoning pointed the
 * other way — a stored v3 board would keep showing the OLD composition to
 * exactly the person who asked for the new one, and the new default is the
 * change. The old keys all still exist, so nothing is dropped; the board
 * simply starts from the reference and any rearrangement from here is
 * theirs again.
 */
const KEY = "neurai-dashboard-layout-v4";

/** the tier a widget takes when added, clamped to what it supports */
export function defaultSizeFor(key: WidgetKey): TileSize {
  const spec = specFor(key);
  if (!spec) return "small";
  return spec.sizes.includes(spec.defaultSize) ? spec.defaultSize : spec.sizes[0]!;
}

/** clamp a size to what this widget is designed at */
export function clampSize(key: WidgetKey, size: TileSize): TileSize {
  const spec = specFor(key);
  if (!spec) return size;
  return spec.sizes.includes(size) ? size : defaultSizeFor(key);
}

/**
 * The starting board — the arrangement the user drew and asked to keep
 * ("fix this as these sizes", 2026-08-29).
 *
 * WRITTEN DOWN, not packed. The earlier version walked the catalogue placing
 * cards left to right and wrapping at the edge, which can express "in this
 * order" and cannot express "the calendar runs full height down the side
 * while two rows of cards fill the rest" — the arrangement that was actually
 * asked for. So each entry carries its own corner in the registry.
 *
 * The SIZES still come from the registry rather than from a coordinate here:
 * a spec change moves the card without leaving a stale span behind, and the
 * layout suite asserts that whatever comes out has no overlaps and fits
 * inside the grid.
 */
export function defaultLayout(): DashboardLayout {
  return {
    tiles: DEFAULT_WIDGETS.map((key) => {
      const spec = specFor(key)!;
      return { key, x: spec.defaultAt?.x ?? 0, y: spec.defaultAt?.y ?? 0, size: defaultSizeFor(key) };
    }),
    density: "comfortable",
  };
}

export function readLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    if (!Array.isArray(parsed.tiles)) return defaultLayout();
    const density: Density = parsed.density === "compact" ? "compact" : "comfortable";
    const seen = new Set<string>();
    const tiles: TilePlacement[] = [];
    for (const tile of parsed.tiles) {
      /* a widget the catalogue has retired, a duplicate, or a tier this
         widget no longer supports — all dropped rather than trusted. The
         registry is the only thing that knows what is real. */
      if (!tile || typeof tile.key !== "string") continue;
      if (!(WIDGETS as string[]).includes(tile.key)) continue;
      if (seen.has(tile.key)) continue;
      seen.add(tile.key);
      const key = tile.key as WidgetKey;
      const size = (TILE_SIZES as readonly string[]).includes(tile.size as string)
        ? clampSize(key, tile.size as TileSize)
        : defaultSizeFor(key);
      tiles.push({
        key,
        x: Math.max(0, Math.min(COLUMNS - 1, Number(tile.x) || 0)),
        y: Math.max(0, Number(tile.y) || 0),
        size,
        ...(tile.pinned === true ? { pinned: true } : {}),
      });
    }
    /* an EMPTY board is a real state a person can reach by hiding every
       card — it must survive a reload rather than being read as "no stored
       layout" and refilled with the defaults */
    return { tiles, density };
  } catch {
    return defaultLayout();
  }
}

/**
 * Is a change the ENGINE reported one to write down?
 *
 * The board lost its arrangement on every reload without this (user report,
 * 2026-08-29: "when i refreshed they go all around"), and both halves have
 * to hold:
 *
 * COLUMNS — gridstack re-lays the board out under a narrower window, twelve
 * columns becoming six and then one, rewriting every x/y/w to fit. That is
 * the engine describing THIS VIEWPORT, not a person moving a tile: saved at
 * six columns, a full-width card reports as half-width and comes back a
 * smaller tier. Storing it overwrites the arrangement with a projection of
 * itself.
 *
 * LOCKED — outside edit mode nothing a person does can move a card, so any
 * change event is the engine's own reflow.
 *
 * It lives here, as a function, because it is a RULE rather than a detail of
 * the adapter: a rule in prose protects whoever is currently remembering it.
 */
export function isPersistableChange(opts: { locked: boolean; columns: number }): boolean {
  return !opts.locked && opts.columns === COLUMNS;
}

export function writeLayout(next: DashboardLayout): void {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* fine */ }
}

/**
 * Where a newly added card goes: the first row below everything already
 * placed, at the start of the line. Never on top of an existing tile — the
 * engine would then push something the person had positioned deliberately.
 */
export function nextFreeSpot(tiles: TilePlacement[]): { x: number; y: number } {
  if (tiles.length === 0) return { x: 0, y: 0 };
  const bottom = Math.max(...tiles.map((tile) => tile.y + SIZE_SPAN[tile.size].h));
  return { x: 0, y: bottom };
}
