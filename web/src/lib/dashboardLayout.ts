"use client";

/**
 * The dashboard's LAYOUT — which widgets, in what order, and how dense
 * (user directive, 2026-08-25: "a full grid and changeable place … so you
 * can move each section and add or remove them").
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
] as const;
export type WidgetKey = (typeof WIDGETS)[number];

/** how wide a widget wants to be, in a 6-column grid */
export const WIDGET_SPAN: Record<WidgetKey, number> = {
  tiles: 6,
  briefing: 6,
  ask: 6,
  pulse: 4,
  commitments: 3,
  decisions: 3,
  topics: 2,
  people: 2,
  pipeline: 2,
  recent: 3,
};

export type Density = "comfortable" | "compact";

export interface DashboardLayout {
  /** the ORDER is the array; membership is the on/off state */
  widgets: WidgetKey[];
  density: Density;
}

const KEY = "neurai-dashboard-layout";

export const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: ["tiles", "briefing", "pulse", "commitments", "decisions", "recent", "pipeline", "ask"],
  density: "comfortable",
};

export function readLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const widgets = Array.isArray(parsed.widgets)
      // a widget removed from the catalogue must not resurrect as a crash
      ? parsed.widgets.filter((w): w is WidgetKey => (WIDGETS as readonly string[]).includes(w))
      : DEFAULT_LAYOUT.widgets;
    return {
      widgets,
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
