"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Me } from "@/api/types";
import { personName } from "@/lib/format";
import { KebabMenu } from "@/components/rowActions";
import {
  DEFAULT_LAYOUT, WIDGETS, WIDGET_SPAN, moveWidget, readLayout, writeLayout,
  type DashboardLayout, type WidgetKey,
} from "@/lib/dashboardLayout";
import { useDashboardData } from "./dashboard/useDashboardData";
import {
  AskWidget, BriefingWidget, LaneWidget, PeopleWidget, PipelineWidget, PulseWidget,
  RecentWidget, TilesWidget, TopicsWidget,
} from "./dashboard/widgets";

/**
 * THE DASHBOARD — the platform's landing page, as a real BENTO GRID (user
 * directive, 2026-08-25): every block can be moved, expanded in place,
 * removed, and brought back.
 *
 * Three decisions worth keeping:
 *
 * · **Expand in place, never navigate.** A card's ⤢ makes it span the grid
 *   and show its deeper rows — the Linear/Datadog pattern. Losing the page
 *   to see one more row is what a dashboard exists to avoid.
 * · **Drag OR keyboard.** Cards are draggable, and the same reordering
 *   lives in each card's ⋯ menu (move up / move down). A drag-only grid is
 *   a grid half the people cannot use.
 * · **The layout is a per-person preference**, stored locally and marked
 *   INTERIM in `lib/dashboardLayout` — a device copy of a convenience, not
 *   a second source for a record.
 */
export function Dashboard() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [expanded, setExpanded] = useState<WidgetKey | null>(null);
  const [dragging, setDragging] = useState<WidgetKey | null>(null);
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

  const compact = layout.density === "compact";

  /** one card's chrome: title, its ⋯, drag handling, and the expand door */
  function Card({ id, children }: { id: WidgetKey; children: ReactNode }) {
    const isOpen = expanded === id;
    const span = isOpen ? 6 : WIDGET_SPAN[id];
    return (
      <section
        draggable
        onDragStart={(e) => {
          setDragging(id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => { if (dragging && dragging !== id) e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          if (!dragging || dragging === id) return;
          update({ ...layout, widgets: moveWidget(layout.widgets, dragging, layout.widgets.indexOf(id)) });
          setDragging(null);
        }}
        style={{ gridColumn: `span ${span} / span ${span}` }}
        className={`glass-card group/card rounded-2xl ${compact ? "p-3" : "p-4"} transition-all ${
          dragging === id ? "opacity-40" : ""
        } ${isOpen ? "ring-1 ring-accent/40" : ""}`}
        aria-label={t(`widget.${id}` as "widget.tiles")}
      >
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="cursor-grab select-none text-sm font-semibold text-fg active:cursor-grabbing">
            {t(`widget.${id}` as "widget.tiles")}
          </h2>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
            <button
              type="button"
              className="tap grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              aria-label={isOpen ? t("collapse") : t("expand")}
              title={isOpen ? t("collapse") : t("expand")}
              onClick={() => setExpanded(isOpen ? null : id)}
            >
              <span aria-hidden className="text-xs">{isOpen ? "⤡" : "⤢"}</span>
            </button>
            <KebabMenu
              label={t("cardMenu")}
              items={[
                { key: "up", label: t("moveUp"), onSelect: () => move(id, -1) },
                { key: "down", label: t("moveDown"), onSelect: () => move(id, 1) },
                { key: "hide", label: t("hide"), danger: true, onSelect: () => toggleWidget(id) },
              ]}
            />
          </span>
        </header>
        {children}
      </section>
    );
  }

  const render = (key: WidgetKey): ReactNode => {
    const open = expanded === key;
    switch (key) {
      case "tiles": return <TilesWidget data={data} expanded={open} />;
      case "briefing": return <BriefingWidget data={data} />;
      case "ask": return <AskWidget />;
      case "pulse": return <PulseWidget data={data} expanded={open} />;
      case "commitments":
        return (
          <LaneWidget
            items={data.actions} depth={data.laneDepth} expanded={open}
            empty={t("commitmentsEmpty")}
          />
        );
      case "decisions":
        return (
          <LaneWidget
            items={data.decisions} depth={data.laneDepth} expanded={open} numbered
            empty={t("decisionsEmpty")}
          />
        );
      case "topics": return <TopicsWidget data={data} />;
      case "people": return <PeopleWidget data={data} />;
      case "pipeline": return <PipelineWidget data={data} />;
      case "recent": return <RecentWidget data={data} expanded={open} />;
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
                ? [{ key: "none", label: t("allShown"), disabled: true }]
                : hidden.map((key) => ({
                    key,
                    label: t(`widget.${key}` as "widget.tiles"),
                    onSelect: () => toggleWidget(key),
                  }))
            }
          />
        </span>
      </div>

      {/* the BENTO: six columns, each card claiming the span it wants */}
      <div className={`grid grid-cols-1 md:grid-cols-6 ${compact ? "gap-2" : "gap-3"}`}>
        {layout.widgets.map((key) => (
          <Card key={key} id={key}>{render(key)}</Card>
        ))}
      </div>

      {layout.widgets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
          {t("emptyBoard")}
        </p>
      ) : null}
    </div>
  );
}
