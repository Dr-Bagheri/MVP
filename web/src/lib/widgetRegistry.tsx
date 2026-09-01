"use client";

import type { ReactNode } from "react";
import { IconAgent, IconCalendar, IconClock, IconMic, IconPlug, IconPulse, IconRows } from "@/components/icons";
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
 * So: same grid, same tiers, same drag and same card shell — and a different
 * catalogue. Every entry below is one of the platform's own surfaces at a
 * glance, and the tile is the surface's own door.
 *
 * The second round (2026-08-29) cut People and Workflows and reshaped the
 * rest: a real month calendar, the connections shown big, the records list
 * smaller, and the record transport in the middle.
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
 *   `sizes`     which tiers this widget is designed at. Not
 *               every widget earns every tier — a card with nothing more to
 *               say at full width does not offer full width, and the menu
 *               greys it out so its range is learnable.
 *   `group`     which section of the add menu it appears under.
 */

/* `people` left with the People tile (2026-08-29): a section of the add
   menu that nothing can ever be in is a heading with no members */
export type WidgetGroup = "overview" | "work" | "ai";

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
  /**
   * Where this card sits on the default board.
   *
   * Written down because the arrangement was DRAWN by the person who wants
   * it ("fix this as these sizes") and a packer cannot express it: the
   * calendar runs full height down one side while two rows of cards fill the
   * rest, which is not any left-to-right walk of this list.
   */
  defaultAt?: { x: number; y: number };
}

/**
 * The catalogue. ORDER HERE is the add-menu's order within each group; the
 * board's own order is the layout's, which a person rearranges.
 *
 * ── the default board is the REFERENCE's arrangement (2026-08-31) ────────
 * User directive: "also the dashbord , i want our dashboard to be like it
 * as well". Their dashboard reads: a stat strip across the top, the week
 * with its meetings as the main panel, upcoming meetings and the latest
 * records beside it, and the working controls below. So the default board
 * composes exactly that; the month calendar and the rest of the catalogue
 * stay one "add" away rather than crowding the first screen. (This revises
 * the earlier all-on-by-default rule — a default that shows everything is
 * a default that arranges nothing.)
 */
export const WIDGET_SPECS = [
  {
    /* the stat strip: four figure cards — today's meetings, open tasks,
       records, connections. The reference's opening row. */
    key: "stats",
    labelKey: "stats",
    icon: <IconPulse />,
    group: "overview",
    sizes: ["band", "wide"],
    defaultSize: "band",
    defaultOrder: 1,
    defaultAt: { x: 0, y: 0 },
  },
  {
    /* the week with its meetings — the reference's main panel */
    key: "week",
    labelKey: "week",
    icon: <IconCalendar />,
    group: "overview",
    sizes: ["large", "hero"],
    defaultSize: "large",
    defaultOrder: 2,
    defaultAt: { x: 0, y: 2 },
  },
  {
    /* what is coming up, as a list — time and title, nearest first */
    key: "upcoming",
    labelKey: "upcoming",
    icon: <IconClock />,
    group: "overview",
    sizes: ["column", "large"],
    defaultSize: "column",
    defaultOrder: 3,
    defaultAt: { x: 6, y: 2 },
  },
  {
    key: "records",
    labelKey: "records",
    icon: <IconRows />,
    group: "work",
    sizes: ["column", "large", "wide", "hero"],
    defaultSize: "column",
    defaultOrder: 4,
    defaultAt: { x: 9, y: 2 },
  },
  {
    key: "record",
    labelKey: "record",
    icon: <IconMic />,
    group: "work",
    /* below the reading row: the transport sits where the hand goes after
       the eye has had the week */
    sizes: ["wide", "large"],
    defaultSize: "wide",
    defaultOrder: 5,
    defaultAt: { x: 0, y: 5 },
  },
  {
    key: "agents",
    labelKey: "agents",
    icon: <IconAgent />,
    group: "ai",
    /* four named agents, always the same four: there is no longer list for a
       bigger tier to reveal */
    sizes: ["small", "column"],
    defaultSize: "small",
    defaultOrder: 6,
    defaultAt: { x: 6, y: 5 },
  },
  {
    key: "integrations",
    labelKey: "integrations",
    icon: <IconPlug />,
    group: "overview",
    /* the four connections as cards, two by two */
    sizes: ["small", "column", "large", "hero"],
    defaultSize: "small",
    defaultOrder: 7,
    defaultAt: { x: 9, y: 5 },
  },
  {
    /* the month grid — off the default board now the week strip carries the
       dashboard's calendar job; one "add" away, not gone */
    key: "calendar",
    labelKey: "calendar",
    icon: <IconCalendar />,
    group: "overview",
    sizes: ["tall", "column"],
    defaultSize: "tall",
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
export const WIDGET_GROUPS: readonly WidgetGroup[] = ["overview", "work", "ai"];
