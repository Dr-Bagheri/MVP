"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { Link } from "@/i18n/routing";
import { KebabMenu } from "@/components/rowActions";
import { IconPlus, IconTrash } from "@/components/icons";
import { EchoMark } from "./icons";
import {
  WIDGET_GROUPS, WIDGET_SPECS, TILE_LOOKS,
  defaultLayout, defaultSizeFor, nextFreeSpot, readLayout, writeLayout, specFor,
  type DashboardLayout, type TilePlacement, type TileSize, type WidgetKey,
} from "@/lib/dashboardLayout";
import { WidgetBoard } from "./dashboard/WidgetBoard";
import { useDashboardData } from "./dashboard/useDashboardData";
import {
  AgentWidget, AskWidget, BriefingWidget, LaneWidget, LedgerWidget, NextWidget,
  PeopleWidget, PipelineWidget, PulseWidget, RecentWidget, TeamWidget, TilesWidget,
  TopicsWidget, WatchlistWidget,
} from "./dashboard/widgets";

/**
 * THE DASHBOARD — the platform's landing page, as a real board.
 *
 * Three layers, and the separation is the point:
 *
 *   REGISTRY (`lib/widgetRegistry`) — what a widget IS. Its icon, its
 *     colour family, the sizes it is designed at, which section of the add
 *     menu it lives in. Adding a gadget is an entry there plus a renderer.
 *   LAYOUT (`lib/dashboardLayout`) — where each card sits and how big.
 *     Free x/y, four fixed sizes, validated against the registry on read so
 *     a stored board can never name something that no longer exists.
 *   ENGINE (`dashboard/WidgetBoard`) — gridstack, doing collision and
 *     reflow. React owns content; the engine owns geometry; neither writes
 *     the other's half.
 *
 * The rules the board keeps:
 *
 * · **Four sizes, from a menu — and a resize handle that snaps to them.**
 *   A closed set is what lets each tier be designed rather than stretched.
 * · **A bigger tile says MORE.** Each widget takes its tier as a prop and
 *   branches; none of them measures itself.
 * · **No gravity.** `float: true` — a card left low stays low, the way a
 *   home screen behaves and a report does not.
 * · **Drag OR menu.** WCAG 2.2 wants a single-pointer path to anything a
 *   drag can do, so every move is also a menu item.
 */
export function Dashboard() {
  const t = useTranslations("dashboard");
  const tPlatform = useTranslations("platform");
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(() => defaultLayout());
  /** the store is only read after mount — SSR has no localStorage */
  const [ready, setReady] = useState(false);
  const data = useDashboardData();

  useEffect(() => {
    setLayout(readLayout());
    setReady(true);
  }, []);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);

  function update(next: DashboardLayout): void {
    setLayout(next);
    writeLayout(next);
  }

  /** the engine's own report — drags, resizes, and its reflow of both */
  function onBoardChange(tiles: TilePlacement[]): void {
    setLayout((prev) => {
      const next = { ...prev, tiles };
      writeLayout(next);
      return next;
    });
  }

  const addWidget = (key: WidgetKey) => {
    if (layout.tiles.some((tile) => tile.key === key)) return;
    const spot = nextFreeSpot(layout.tiles);
    update({
      ...layout,
      tiles: [...layout.tiles, { key, ...spot, size: defaultSizeFor(key) }],
    });
  };
  const removeWidget = (key: WidgetKey) =>
    update({ ...layout, tiles: layout.tiles.filter((tile) => tile.key !== key) });

  /** one card's chrome — the chip, the title, the ⋯, and the drag grip */
  function Tile({ tile }: { tile: TilePlacement }) {
    const spec = specFor(tile.key);
    if (!spec) return null;
    const look = TILE_LOOKS[spec.look];
    const label = t(`widget.${spec.labelKey}` as "widget.tiles");
    const compact = layout.density === "compact";
    return (
      <section
        className={`tile group/card ${look.className} ${look.ink === "on-gradient" ? "on-gradient" : ""} ${
          compact ? "p-3" : "p-4"
        }`}
        aria-label={label}
      >
        {/* the card's mark — decorative, so it is aria-hidden and sits
            behind everything with pointer events off */}
        {spec.art ? (
          <img
            src={`/art/${spec.art}.png`}
            alt=""
            aria-hidden
            className="tile-art"
            width={260}
            height={260}
          />
        ) : null}
        <header className="mb-2.5 flex items-center gap-3">
          <span className="tile-chip">{spec.icon}</span>
          <h2 className="min-w-0 flex-1 select-none truncate text-[0.95rem] font-semibold">
            {label}
          </h2>
          {/*
            One control, not a menu (user directive, 2026-08-26). Moving is
            press-and-hold on the card; resizing is the corner grip. Neither
            needs a menu entry, and a menu holding only "remove" is a menu
            that should have been a button.

            `data-nodrag` keeps a press here from becoming a drag — the
            engine's cancel list reads it.
          */}
          <button
            type="button"
            data-nodrag
            aria-label={t("hide")}
            title={t("hide")}
            className="tile-remove"
            onClick={() => removeWidget(tile.key)}
          >
            <IconTrash width={16} height={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1">{renderBody(tile.key, tile.size)}</div>
      </section>
    );
  }

  /**
   * The tier reaches every widget as a PROP. A widget that read its own
   * width would be doing free-form responsive with extra steps — and the
   * whole point of a closed set of sizes is that each one is designed.
   */
  function renderBody(key: WidgetKey, size: TileSize): ReactNode {
    switch (key) {
      case "tiles": return <TilesWidget data={data} size={size} />;
      case "briefing": return <BriefingWidget data={data} size={size} />;
      case "ask": return <AskWidget size={size} />;
      case "pulse": return <PulseWidget data={data} size={size} />;
      case "commitments":
        return (
          <LaneWidget
            items={data.actions} depth={data.laneDepth} size={size}
            empty={t("commitmentsEmpty")}
          />
        );
      case "decisions":
        return (
          <LaneWidget
            items={data.decisions} depth={data.laneDepth} size={size} numbered
            empty={t("decisionsEmpty")}
          />
        );
      case "topics": return <TopicsWidget data={data} size={size} />;
      case "people": return <PeopleWidget data={data} size={size} />;
      case "pipeline": return <PipelineWidget data={data} size={size} />;
      case "recent": return <RecentWidget data={data} size={size} />;
      case "watchlist": return <WatchlistWidget data={data} size={size} />;
      case "ledger": return <LedgerWidget data={data} size={size} />;
      case "next": return <NextWidget data={data} size={size} />;
      case "team": return <TeamWidget data={data} size={size} />;
      case "agent": return <AgentWidget size={size} />;
      default: return null;
    }
  }

  const onBoard = new Set(layout.tiles.map((tile) => tile.key));
  const hidden = WIDGET_SPECS.filter((spec) => !onBoard.has(spec.key));

  return (
    <div className="space-y-5">
      {/* ── the head: who, and the way into the app ──────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {/*
            THE ECHO BUTTON, AT THE TOP (user directive, 2026-08-26). It is
            the first thing on the page because opening the app is the most
            common reason to be here — every tile below is something you
            read, and this is the one thing you LEAVE for.
          */}
          <Link href="/echo" className="launcher tap">
            <span className="launcher-mark"><EchoMark size={20} /></span>
            <span className="text-start leading-tight">
              <span className="block text-sm font-semibold">{tPlatform("echo")}</span>
              <span className="block text-[11px] opacity-80">{tPlatform("echoDesc")}</span>
            </span>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold leading-tight text-fg">
              {me ? t("greeting", { name: personName(me, locale) }) : t("greetingPlain")}
            </h1>
            <p className="text-xs text-fg-muted">{t("subtitle")}</p>
          </div>
        </div>

        <span className="flex items-center gap-2">
          <span className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label={t("density")}>
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={layout.density === d}
                className={`h-8 px-2.5 text-xs transition-colors ${
                  layout.density === d
                    ? "bg-accent-soft font-semibold text-accent"
                    : "bg-surface text-fg-muted hover:text-fg"
                }`}
                onClick={() => update({ ...layout, density: d })}
              >
                {t(d)}
              </button>
            ))}
          </span>
          {/* ADD — grouped by the registry's own sections, so the menu
              organises itself as the catalogue grows */}
          <KebabMenu
            label={t("addWidget")}
            trigger={<span className="text-xs">＋ {t("addWidget")}</span>}
            items={
              hidden.length === 0
                ? [{ key: "none", label: t("allShown"), icon: null, disabled: true }]
                : WIDGET_GROUPS.filter((group) => hidden.some((s) => s.group === group)).map(
                    (group) => ({
                      key: group,
                      label: t(`group.${group}` as "group.overview"),
                      icon: <IconPlus />,
                      sub: hidden
                        .filter((spec) => spec.group === group)
                        .map((spec) => ({
                          key: spec.key,
                          label: t(`widget.${spec.labelKey}` as "widget.tiles"),
                          icon: spec.icon,
                          onSelect: () => addWidget(spec.key),
                        })),
                    }),
                  )
            }
          />
        </span>
      </div>

      {/* ── the board ───────────────────────────────────────────────── */}
      {ready ? (
        <WidgetBoard
          layout={layout}
          onChange={onBoardChange}
          renderTile={(key) => {
            const tile = layout.tiles.find((candidate) => candidate.key === key);
            return tile ? <Tile tile={tile} /> : null;
          }}
        />
      ) : null}

      {layout.tiles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-fg-muted">
          {t("emptyBoard")}
        </p>
      ) : null}
    </div>
  );
}
