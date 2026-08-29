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
 * FOUR SIZES, NOT FREE RESIZE. Every platform that ships home-screen
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
 * The four tiers, on a 12-column grid. Named for what they look like
 * rather than for their span, because the name is what the size menu shows.
 * Twelve columns rather than six so a `small` tile is a genuine quarter and
 * the engine can pack without half-column rounding.
 */
export const TILE_SIZES = ["small", "wide", "large", "hero"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const COLUMNS = 12;

/** columns × rows for each tier; one row is one grid track */
export const SIZE_SPAN: Record<TileSize, { w: number; h: number }> = {
  small: { w: 3, h: 2 },
  wide: { w: 6, h: 2 },
  large: { w: 6, h: 3 },
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
  return { small: 3, wide: 3, large: 6, hero: 12 }[size];
}

export type Density = "comfortable" | "compact";

/** one card's placement — the unit the engine and the store both speak */
export interface TilePlacement {
  key: WidgetKey;
  x: number;
  y: number;
  size: TileSize;
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
 */
const KEY = "neurai-dashboard-layout-v3";

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
 * The starting board: the registry's default widgets, packed left to right
 * at their default sizes. Computed rather than hand-written, so changing a
 * widget's default size cannot leave a stale coordinate behind.
 */
export function defaultLayout(): DashboardLayout {
  const tiles: TilePlacement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const key of DEFAULT_WIDGETS) {
    const size = defaultSizeFor(key);
    const span = SIZE_SPAN[size];
    if (x + span.w > COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    tiles.push({ key, x, y, size });
    x += span.w;
    rowHeight = Math.max(rowHeight, span.h);
  }
  return { tiles, density: "comfortable" };
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
