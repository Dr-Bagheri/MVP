"use client";

import type { ReactNode } from "react";
import {
  IconAgent, IconArchive, IconAsk, IconGauge, IconGavel, IconMic, IconPeople3,
  IconPulse, IconRows, IconSparkle, IconTag, IconUsers, IconVoice, IconZap,
} from "@/components/icons";
import type { TileSize } from "@/lib/dashboardLayout";

/**
 * THE WIDGET REGISTRY — the dashboard's actual structure.
 *
 * The board does not know what a "briefing" or a "watchlist" is. It reads
 * this table, and everything downstream is derived from it: the add-a-card
 * menu, the size menu's options, the card's colour and icon, the default
 * layout, the persisted layout's validation. Adding a gadget is ONE entry
 * here plus a renderer — not an edit in five files that must agree.
 *
 * Each entry declares:
 *   `size`      which of the four tiers this widget is designed at. Not
 *               every widget earns every tier — a card with nothing more to
 *               say at full width does not offer full width, and the menu
 *               greys it out so its range is learnable.
 *   `look`      the tile's visual family (see TILE_LOOKS below). This is
 *               the part the reference design turns on: a board where every
 *               card is the same grey rectangle reads as a table with extra
 *               steps.
 *   `group`     which section of the add menu it appears under.
 *   `needs`     what the widget reads. `records` widgets go quiet with an
 *               honest line when the org has none, rather than rendering a
 *               confident zero.
 */

/** the visual families a tile can wear — the board's whole colour story */
export const TILE_LOOKS = {
  /** the hero: the accent blue as a full gradient, white ink */
  feature: {
    className: "tile-feature",
    ink: "on-gradient",
  },
  /** the second accent — warmer, for the tile that answers a question */
  warm: {
    className: "tile-warm",
    ink: "on-gradient",
  },
  /** cool: reserved for pipeline/health, where blue reads as "system" */
  cool: {
    className: "tile-cool",
    ink: "on-gradient",
  },
  /** the quiet default — surface with a hairline, ordinary ink */
  plain: {
    className: "tile-plain",
    ink: "normal",
  },
  /** a plain tile with a tinted icon chip — most list cards */
  tinted: {
    className: "tile-tinted",
    ink: "normal",
  },
} as const;
export type TileLook = keyof typeof TILE_LOOKS;

export type WidgetGroup = "overview" | "work" | "people" | "ai";

export interface WidgetSpec {
  key: string;
  /** the message key under `dashboard.widget.*` */
  labelKey: string;
  icon: ReactNode;
  look: TileLook;
  group: WidgetGroup;
  sizes: readonly TileSize[];
  defaultSize: TileSize;
  /** what it reads — drives the honest empty state */
  needs: "records" | "people" | "nothing";
  /** in the default board, and in what order */
  defaultOrder?: number;
  /**
   * A decorative mark for the card's corner — white line-art on
   * transparency, drawn from `web/public/art/marks.html`. Only the
   * gradient families carry one: on a plain surface a white flourish is
   * invisible, and a tinted one competes with the content.
   */
  art?: string;
}

/**
 * The catalogue. ORDER HERE is the add-menu's order within each group; the
 * board's own order is the layout's, which a person rearranges.
 */
export const WIDGET_SPECS = [
  {
    key: "tiles",
    labelKey: "tiles",
    art: "tiles",
    icon: <IconGauge />,
    look: "feature",
    group: "overview",
    sizes: ["wide", "hero"],
    defaultSize: "hero",
    needs: "records",
    defaultOrder: 1,
  },
  {
    key: "briefing",
    labelKey: "briefing",
    art: "briefing",
    icon: <IconSparkle />,
    look: "warm",
    group: "ai",
    sizes: ["large", "hero"],
    defaultSize: "large",
    needs: "records",
    defaultOrder: 2,
  },
  {
    key: "pulse",
    labelKey: "pulse",
    icon: <IconPulse />,
    look: "plain",
    group: "overview",
    sizes: ["wide", "large", "hero"],
    defaultSize: "large",
    needs: "records",
    defaultOrder: 3,
  },
  {
    key: "commitments",
    labelKey: "commitments",
    icon: <IconZap />,
    look: "tinted",
    group: "work",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    needs: "records",
    defaultOrder: 4,
  },
  {
    key: "decisions",
    labelKey: "decisions",
    icon: <IconGavel />,
    look: "tinted",
    group: "work",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    needs: "records",
    defaultOrder: 5,
  },
  {
    key: "recent",
    labelKey: "recent",
    icon: <IconRows />,
    look: "tinted",
    group: "work",
    sizes: ["small", "large", "hero"],
    defaultSize: "large",
    needs: "records",
    defaultOrder: 6,
  },
  {
    key: "next",
    labelKey: "next",
    icon: <IconMic />,
    look: "tinted",
    group: "people",
    sizes: ["small", "large"],
    defaultSize: "large",
    needs: "people",
    defaultOrder: 7,
  },
  {
    key: "pipeline",
    labelKey: "pipeline",
    art: "pipeline",
    icon: <IconArchive />,
    look: "cool",
    group: "overview",
    sizes: ["small", "wide"],
    defaultSize: "small",
    needs: "records",
    defaultOrder: 8,
  },
  {
    key: "ask",
    labelKey: "ask",
    art: "ask",
    icon: <IconAsk />,
    look: "feature",
    group: "ai",
    sizes: ["wide", "hero"],
    defaultSize: "wide",
    needs: "nothing",
    defaultOrder: 9,
  },
  {
    key: "topics",
    labelKey: "topics",
    icon: <IconTag />,
    look: "tinted",
    group: "work",
    sizes: ["small", "large"],
    defaultSize: "small",
    needs: "records",
  },
  {
    key: "people",
    labelKey: "people",
    icon: <IconPeople3 />,
    look: "tinted",
    group: "people",
    sizes: ["small", "large"],
    defaultSize: "small",
    needs: "people",
  },
  {
    key: "watchlist",
    labelKey: "watchlist",
    icon: <IconVoice />,
    look: "tinted",
    group: "work",
    sizes: ["small", "large", "hero"],
    defaultSize: "small",
    needs: "records",
  },
  {
    key: "ledger",
    labelKey: "ledger",
    icon: <IconGavel />,
    look: "plain",
    group: "work",
    sizes: ["large", "hero"],
    defaultSize: "large",
    needs: "records",
  },
  {
    key: "team",
    labelKey: "team",
    icon: <IconUsers />,
    look: "tinted",
    group: "people",
    sizes: ["small", "large"],
    defaultSize: "small",
    needs: "people",
  },
  {
    key: "agent",
    labelKey: "agent",
    icon: <IconAgent />,
    look: "plain",
    group: "ai",
    sizes: ["small", "large"],
    defaultSize: "small",
    needs: "nothing",
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
