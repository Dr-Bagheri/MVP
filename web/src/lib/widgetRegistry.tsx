"use client";

import type { ReactNode } from "react";
import {
  IconAgent, IconCalendar, IconMic, IconPlug, IconRows, IconUsers, IconZap,
} from "@/components/icons";
import type { TileSize } from "@/lib/dashboardLayout";

/**
 * THE WIDGET REGISTRY — the dashboard's actual structure.
 *
 * The board does not know what a "records" or a "workflows" tile is. It reads
 * this table, and everything downstream is derived from it: the add-a-card
 * menu, the size menu's options, the card's icon, the default layout, the
 * persisted layout's validation. Adding a gadget is ONE entry here plus a
 * renderer — not an edit in five files that must agree.
 *
 * ── what the board is now (user directive, 2026-08-29) ───────────────────
 * "keep the grid and size and the visual we have and get rid of the colors,
 * we need new tabs there, the functions we have in the platform in mini
 * version".
 *
 * So: same grid, same four tiers, same drag and same card shell — and a
 * different catalogue. Every entry below is one of the platform's own
 * surfaces at a glance, and the tile is the surface's own door.
 *
 * ── the colours went, and with them the `look` field ────────────────────
 * The board used to carry five visual families (three gradients, a tint, a
 * plain). Removing the gradients would have left `look` as a field with one
 * value — a producer with no consumer wearing a design system's name — so
 * the field went with them and the shell paints itself. The card's identity
 * is now its icon and its title, which is what a glance surface reads by
 * anyway.
 *
 * Each entry declares:
 *   `sizes`     which of the four tiers this widget is designed at. Not
 *               every widget earns every tier — a card with nothing more to
 *               say at full width does not offer full width, and the menu
 *               greys it out so its range is learnable.
 *   `group`     which section of the add menu it appears under.
 */

export type WidgetGroup = "overview" | "work" | "people" | "ai";

export interface WidgetSpec {
  key: string;
  /** the message key under `dashboard.widget.*` */
  labelKey: string;
  icon: ReactNode;
  group: WidgetGroup;
  sizes: readonly TileSize[];
  defaultSize: TileSize;
  /** in the default board, and in what order */
  defaultOrder?: number;
}

/**
 * The catalogue. ORDER HERE is the add-menu's order within each group; the
 * board's own order is the layout's, which a person rearranges.
 *
 * All seven are on the default board: the point of the board is that the
 * platform's functions are visible at once, and a default that hid half of
 * them would make the other half look like the whole product.
 */
export const WIDGET_SPECS = [
  {
    key: "records",
    labelKey: "records",
    icon: <IconRows />,
    group: "work",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    defaultOrder: 1,
  },
  {
    key: "calendar",
    labelKey: "calendar",
    icon: <IconCalendar />,
    group: "overview",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    defaultOrder: 2,
  },
  {
    key: "members",
    labelKey: "members",
    icon: <IconUsers />,
    group: "people",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    defaultOrder: 3,
  },
  {
    key: "workflows",
    labelKey: "workflows",
    icon: <IconZap />,
    group: "ai",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    defaultOrder: 4,
  },
  {
    key: "agents",
    labelKey: "agents",
    icon: <IconAgent />,
    group: "ai",
    /* FOUR named agents, always the same four: there is no longer list for a
       bigger tier to reveal, so it does not offer one */
    sizes: ["small", "large"],
    defaultSize: "small",
    defaultOrder: 5,
  },
  {
    key: "integrations",
    labelKey: "integrations",
    icon: <IconPlug />,
    group: "overview",
    sizes: ["small", "large"],
    defaultSize: "small",
    defaultOrder: 6,
  },
  {
    key: "record",
    labelKey: "record",
    icon: <IconMic />,
    group: "work",
    /* one button: a taller tile would be a taller button, and the law of the
       four sizes is that a bigger tile says MORE */
    sizes: ["small", "wide"],
    defaultSize: "wide",
    defaultOrder: 7,
  },
] as const satisfies readonly WidgetSpec[];

/** the specs, widened back to the interface so optional fields survive the
    `as const` narrowing (a literal type drops a key an entry omits) */
const SPECS: readonly WidgetSpec[] = WIDGET_SPECS;

export type WidgetKey = (typeof WIDGET_SPECS)[number]["key"];

/** every key, for the layout reader's validation */
export const WIDGETS = SPECS.map((w) => w.key) as WidgetKey[];

const BY_KEY = new Map<string, WidgetSpec>(
  SPECS.map((spec) => [spec.key, spec]),
);

/**
 * The spec for a key. Returns undefined for a key the catalogue does not
 * know — a stored layout naming a retired widget must resolve to "nothing
 * to render", never to a crash.
 */
export function specFor(key: string): WidgetSpec | undefined {
  return BY_KEY.get(key);
}

/** the board a person sees before they have arranged one */
export const DEFAULT_WIDGETS: WidgetKey[] = SPECS
  .filter((w) => w.defaultOrder !== undefined)
  .slice()
  .sort((a, b) => (a.defaultOrder ?? 99) - (b.defaultOrder ?? 99))
  .map((w) => w.key as WidgetKey);

/** the add menu's sections, in the order they appear */
export const WIDGET_GROUPS: readonly WidgetGroup[] =
  ["overview", "work", "people", "ai"];
