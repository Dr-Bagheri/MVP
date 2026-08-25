"use client";

/**
 * The dashboard's LAYOUT — which widgets, in what order, at what SIZE, and
 * how dense (user directives, 2026-08-25 and 2026-08-26: "a full grid and
 * changeable place … so you can move each section and add or remove them",
 * then "make it four sizes for each, it must be like a screen of an android,
 * easy to use and user friendly").
 *
 * FOUR SIZES, NOT FREE RESIZE. Every platform that ships home-screen widgets
 * lands on a small closed set — Windows 11 ships three (small/medium/large),
 * Apple's system family is four, and Android's Play quality bar names 2x2,
 * 4x1 and 4x2 as the target set. A closed set is what lets a widget be
 * DESIGNED at each size instead of stretched to fit, and it is what makes a
 * menu the right control: four named choices, not a handle that implies
 * continuous resize and then snaps.
 *
 * The law that comes with it, in Apple's words and Android's Weather
 * example alike: a bigger tile shows MORE INFORMATION, never the same
 * content scaled up. Each step is additive — the subject stays put and the
 * range around it grows. Widgets receive their size as a PROP and branch on
 * it; none of them measures itself, which is the difference between fixed
 * tiers and free-form responsive.
 *
 * INTERIM store: localStorage, per browser, marked as such. A layout is a
 * per-person convenience, not a record — losing it costs a drag, not data.
 * The named upgrade is `app_user.dashboard_layout` (the preferences slot
 * that already carries calendar/timezone), at which point this file's
 * read/write swaps for the wire and the shape below stays.
 */

/** every widget the dashboard can render — the catalogue IS the vocabulary */
export const WIDGETS = [
  "tiles",
  "briefing",
  "ask",
  "pulse",
  "commitments",
  "decisions",
  "topics",
  "people",
  "pipeline",
  "recent",
  "watchlist",
  "ledger",
  "next",
] as const;
export type WidgetKey = (typeof WIDGETS)[number];

/**
 * The four tiers, on a 6-column grid. Named for what they look like rather
 * than for their span, because the name is what the size menu shows.
 */
export const TILE_SIZES = ["small", "wide", "large", "hero"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/** columns × rows for each tier; one row is one grid track */
export const SIZE_SPAN: Record<TileSize, { cols: number; rows: number }> = {
  small: { cols: 2, rows: 1 },
  wide: { cols: 4, rows: 1 },
  large: { cols: 3, rows: 2 },
  hero: { cols: 6, rows: 2 },
};

/**
 * Which sizes each widget actually SUPPORTS.
 *
 * Not every widget earns every tier: Apple's rule is that a sparse layout
 * makes a widget seem unnecessary, and Android's quality bar (WL-4.1) says
 * outright that a maximum size must be set when growing only adds blank
 * space. So a tile that has nothing more to say at `hero` does not offer
 * `hero`, and the menu greys it out rather than hiding it — a person
 * learns the widget's range by seeing where it stops.
 */
export const WIDGET_SIZES: Record<WidgetKey, readonly TileSize[]> = {
  tiles: ["wide", "hero"],
  briefing: ["large", "hero"],
  ask: ["wide", "hero"],
  pulse: ["wide", "large", "hero"],
  commitments: ["small", "large", "hero"],
  decisions: ["small", "large", "hero"],
  topics: ["small", "large"],
  people: ["small", "large"],
  pipeline: ["small", "wide"],
  recent: ["small", "large", "hero"],
  watchlist: ["small", "large", "hero"],
  ledger: ["large", "hero"],
  next: ["small", "large"],
};

/** the size a widget takes when it is first added, or when its stored size
    is no longer one it supports */
export const DEFAULT_SIZE: Record<WidgetKey, TileSize> = {
  tiles: "hero",
  briefing: "large",
  ask: "wide",
  pulse: "large",
  commitments: "large",
  decisions: "large",
  topics: "small",
  people: "small",
  pipeline: "small",
  recent: "large",
  watchlist: "small",
  ledger: "large",
  next: "small",
};

export type Density = "comfortable" | "compact";

export interface DashboardLayout {
  /** the ORDER is the array; membership is the on/off state */
  widgets: WidgetKey[];
  /** per-widget tier; a missing entry means DEFAULT_SIZE */
  sizes: Partial<Record<WidgetKey, TileSize>>;
  density: Density;
}

const KEY = "neurai-dashboard-layout";

export const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: [
    "tiles", "briefing", "pulse", "commitments", "decisions",
    "recent", "next", "pipeline", "ask",
  ],
  sizes: {},
  density: "comfortable",
};

/** the tier a widget is at right now, clamped to what it supports */
export function sizeOf(layout: DashboardLayout, key: WidgetKey): TileSize {
  const stored = layout.sizes[key];
  const allowed = WIDGET_SIZES[key];
  if (stored && allowed.includes(stored)) return stored;
  const fallback = DEFAULT_SIZE[key];
  return allowed.includes(fallback) ? fallback : allowed[0]!;
}

export function readLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const widgets = Array.isArray(parsed.widgets)
      // a widget removed from the catalogue must not resurrect as a crash
      ? parsed.widgets.filter((w): w is WidgetKey => (WIDGETS as readonly string[]).includes(w))
      : DEFAULT_LAYOUT.widgets;
    /* a stored size for a retired widget, or a tier the widget no longer
       supports, is dropped rather than trusted — `sizeOf` then answers
       from the catalogue, which is the only thing that knows the truth */
    const sizes: Partial<Record<WidgetKey, TileSize>> = {};
    for (const [key, value] of Object.entries(parsed.sizes ?? {})) {
      if (!(WIDGETS as readonly string[]).includes(key)) continue;
      if (!(TILE_SIZES as readonly string[]).includes(value as string)) continue;
      sizes[key as WidgetKey] = value as TileSize;
    }
    return {
      widgets,
      sizes,
      density: parsed.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function writeLayout(next: DashboardLayout): void {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* fine */ }
}

/** move `key` to `index`, keeping every other widget's relative order */
export function moveWidget(widgets: WidgetKey[], key: WidgetKey, index: number): WidgetKey[] {
  const without = widgets.filter((w) => w !== key);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), key, ...without.slice(at)];
}
