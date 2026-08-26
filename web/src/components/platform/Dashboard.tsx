"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { Link } from "@/i18n/routing";
import { KebabMenu } from "@/components/rowActions";
import {
  IconArrowDown, IconArrowUp, IconHide, IconMove, IconPlus, IconResize,
  IconToEnd, IconToStart,
} from "@/components/icons";
import { EchoMark } from "./icons";
import {
  DEFAULT_LAYOUT, SIZE_SPAN, TILE_SIZES, WIDGETS, WIDGET_SIZES,
  moveWidget, readLayout, sizeOf, writeLayout,
  type DashboardLayout, type TileSize, type WidgetKey,
} from "@/lib/dashboardLayout";
import { useDashboardData } from "./dashboard/useDashboardData";
import {
  AskWidget, BriefingWidget, LaneWidget, LedgerWidget, NextWidget, PeopleWidget,
  PipelineWidget, PulseWidget, RecentWidget, TilesWidget, TopicsWidget, WatchlistWidget,
} from "./dashboard/widgets";

/**
 * THE DASHBOARD — the platform's landing page, as a HOME SCREEN (user
 * directives, 2026-08-25 and 2026-08-26: a grid you arrange, then "four
 * sizes for each … like a screen of an android, easy to use").
 *
 * The decisions that make it feel like one, and why:
 *
 * · **Four sizes, chosen from a menu.** Not a drag handle: with a closed set
 *   of tiers a handle implies continuous resize and then snaps, which reads
 *   as broken. Windows 11 uses a per-widget menu for exactly this; iOS 18
 *   added a tap-to-pick menu on top of its handle. Unsupported tiers are
 *   greyed, never hidden — that is how a person learns a widget's range.
 * · **A bigger tile says MORE, never the same thing larger.** Each widget
 *   takes its tier as a prop and branches; none of them measures itself.
 *   Measuring is what free-form responsive does, and it is why responsive
 *   cards all end up looking like one card at three widths.
 * · **No gravity.** A home screen does not compact upward — an icon left at
 *   the bottom stays at the bottom. Cards keep the order you put them in;
 *   nothing flies up to fill a gap you left on purpose.
 * · **Drag OR menu.** WCAG 2.2's dragging-movements rule is not optional and
 *   rearranging is not "essential", so every drag has a menu twin (move up /
 *   move down). It is also simply better on a phone.
 * · **The layout is a per-person preference**, stored locally and marked
 *   INTERIM in `lib/dashboardLayout` — a device copy of a convenience, not
 *   a second source for a record.
 */
export function Dashboard() {
  const t = useTranslations("dashboard");
  const tPlatform = useTranslations("platform");
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [dragging, setDragging] = useState<WidgetKey | null>(null);
  const [over, setOver] = useState<WidgetKey | null>(null);
  const data = useDashboardData();

  useEffect(() => { setLayout(readLayout()); }, []);
  useEffect(() => { void api.me().then(setMe).catch(() => setMe(null)); }, []);

  function update(next: DashboardLayout): void {
    setLayout(next);
    writeLayout(next);
  }
  const toggleWidget = (key: WidgetKey) =>
    update({
      ...layout,
      widgets: layout.widgets.includes(key)
        ? layout.widgets.filter((w) => w !== key)
        : [...layout.widgets, key],
    });
  const move = (key: WidgetKey, delta: number) => {
    const at = layout.widgets.indexOf(key);
    if (at < 0) return;
    update({ ...layout, widgets: moveWidget(layout.widgets, key, at + delta) });
  };
  const resize = (key: WidgetKey, size: TileSize) =>
    update({ ...layout, sizes: { ...layout.sizes, [key]: size } });

  const compact = layout.density === "compact";

  /** one tile's chrome: title, the size picker, drag handling, the ⋯ */
  function Tile({ id, children }: { id: WidgetKey; children: ReactNode }) {
    const size = sizeOf(layout, id);
    const { cols, rows } = SIZE_SPAN[size];
    const allowed = WIDGET_SIZES[id];
    return (
      <section
        draggable
        onDragStart={(e) => {
          setDragging(id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
        onDragOver={(e) => {
          if (!dragging || dragging === id) return;
          e.preventDefault();
          setOver(id);
        }}
        onDragLeave={() => setOver((prev) => (prev === id ? null : prev))}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          if (!dragging || dragging === id) return;
          update({
            ...layout,
            widgets: moveWidget(layout.widgets, dragging, layout.widgets.indexOf(id)),
          });
          setDragging(null);
        }}
        style={{
          gridColumn: `span ${cols} / span ${cols}`,
          gridRow: `span ${rows} / span ${rows}`,
        }}
        className={`glass-card group/card flex flex-col overflow-hidden rounded-2xl ${
          compact ? "p-3" : "p-4"
        } transition-[opacity,box-shadow,transform] duration-150 ${
          dragging === id ? "scale-[0.98] opacity-40" : ""
        } ${over === id ? "ring-2 ring-accent" : ""}`}
        aria-label={t(`widget.${id}` as "widget.tiles")}
      >
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="cursor-grab select-none truncate text-sm font-semibold text-fg active:cursor-grabbing">
            {t(`widget.${id}` as "widget.tiles")}
          </h2>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
            <KebabMenu
              label={t("cardMenu")}
              items={[
                {
                  /* the SIZE picker, as a flyout: four named tiers, the
                     unsupported ones disabled rather than absent */
                  key: "size",
                  label: t("sizeLabel"),
                  icon: <IconResize />,
                  sub: TILE_SIZES.map((s) => ({
                    key: s,
                    label: t(`size.${s}` as "size.small"),
                    /* a size is a VALUE, not an action — the gutter stays,
                       the glyph does not (the deliberate `icon: null`) */
                    icon: null,
                    disabled: !allowed.includes(s) || size === s,
                    onSelect: () => resize(id, s),
                  })),
                },
                {
                  /* the drag's twin — WCAG 2.2 SC 2.5.7 wants a single-pointer
                     path to anything a drag can do, and this is also just the
                     way to move a tile on a phone */
                  key: "move",
                  label: t("moveTile"),
                  icon: <IconMove />,
                  sub: [
                    { key: "up", label: t("moveUp"), icon: <IconArrowUp />, onSelect: () => move(id, -1) },
                    { key: "down", label: t("moveDown"), icon: <IconArrowDown />, onSelect: () => move(id, 1) },
                    { key: "first", label: t("moveFirst"), icon: <IconToStart />, onSelect: () => move(id, -layout.widgets.length) },
                    { key: "last", label: t("moveLast"), icon: <IconToEnd />, onSelect: () => move(id, layout.widgets.length) },
                  ],
                },
                {
                  key: "hide",
                  label: t("hide"),
                  icon: <IconHide />,
                  danger: true,
                  onSelect: () => toggleWidget(id),
                },
              ]}
            />
          </span>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </section>
    );
  }

  /**
   * The tier reaches every widget as a PROP. A widget that read its own
   * width would be doing free-form responsive with extra steps — and the
   * whole point of a closed set of sizes is that each one is designed.
   */
  const render = (key: WidgetKey): ReactNode => {
    const size = sizeOf(layout, key);
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
    }
  };

  const hidden = WIDGETS.filter((w) => !layout.widgets.includes(w));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold leading-tight text-fg">
            {me ? t("greeting", { name: personName(me, locale) }) : t("greetingPlain")}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t("subtitle")}</p>
        </div>
        <span className="flex items-center gap-2">
          {/* DENSITY — the same board for a phone glance and a wall display */}
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
          {/* ADD a widget back — the catalogue, minus what is already up */}
          <KebabMenu
            label={t("addWidget")}
            trigger={<span className="text-xs">＋ {t("addWidget")}</span>}
            items={
              hidden.length === 0
                ? [{ key: "none", label: t("allShown"), icon: null, disabled: true }]
                : hidden.map((key) => ({
                    key,
                    label: t(`widget.${key}` as "widget.tiles"),
                    icon: <IconPlus />,
                    onSelect: () => toggleWidget(key),
                  }))
            }
          />
        </span>
      </div>

      {/*
        THE BOARD. Six columns, a fixed row height so a tier means the same
        thing everywhere, and `grid-flow-dense` so a small tile fills the
        hole a large one leaves beside it — the packing an Android home
        screen does, without ever reordering the tiles themselves.

        One column below `md`: the narrow answer is a single column in
        source order, which is what Notion does and what never surprises
        anyone. Auto rows there, because a fixed row height on a phone
        turns every tier into the same box.
      */}
      <div
        className={`grid auto-rows-min grid-cols-1 md:auto-rows-[9.5rem] md:grid-flow-dense md:grid-cols-6 ${
          compact ? "gap-2 md:auto-rows-[8rem]" : "gap-3"
        }`}
      >
        {layout.widgets.map((key) => (
          <Tile key={key} id={key}>{render(key)}</Tile>
        ))}
      </div>

      {layout.widgets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          {t("emptyBoard")}
        </p>
      ) : null}

      {/*
        THE APP LAUNCHER (user directive, 2026-08-26: the Echo card moves
        off the assistant's prompt box and onto the dashboard). It sits
        under the board rather than in it: an app is a place you leave for,
        and the tiles above are things you read without leaving.
      */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(226px,1fr))] gap-3 pt-1">
        <Link
          href="/echo"
          className="glass-tile flex items-center gap-3 rounded-2xl p-3.5 text-start transition-colors hover:border-border-strong"
        >
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-surface-2">
            <EchoMark size={28} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">{tPlatform("echo")}</span>
            <span className="block text-xs text-fg-muted">{tPlatform("echoDesc")}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
