"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { KebabMenu } from "@/components/rowActions";
import { IconCheck, IconPencil, IconPin, IconPlus, IconTrash } from "@/components/icons";
import {
  WIDGET_GROUPS, WIDGET_SPECS,
  defaultLayout, defaultSizeFor, nextFreeSpot, readLayout, writeLayout, specFor,
  type DashboardLayout, type TilePlacement, type TileSize, type WidgetKey,
} from "@/lib/dashboardLayout";
import { WidgetBoard } from "./dashboard/WidgetBoard";
import {
  AgentsWidget, CalendarWidget, IntegrationsWidget, RecordsMiniWidget, StartRecordWidget,
  StatsWidget, UpcomingWidget, WeekWidget,
} from "./dashboard/miniWidgets";

/**
 * THE DASHBOARD — the platform's landing page, as a real board.
 *
 * Three layers, and the separation is the point:
 *
 *   REGISTRY (`lib/widgetRegistry`) — what a widget IS. Its icon, the sizes
 *     it is designed at, which section of the add menu it lives in. Adding
 *     a gadget is an entry there plus a renderer.
 *   LAYOUT (`lib/dashboardLayout`) — where each card sits and how big.
 *     Free x/y, a closed set of sizes, validated against the registry on read so
 *     a stored board can never name something that no longer exists.
 *   ENGINE (`dashboard/WidgetBoard`) — gridstack, doing collision and
 *     reflow. React owns content; the engine owns geometry; neither writes
 *     the other's half.
 *
 * The rules the board keeps:
 *
 * · **A closed set of sizes, and a resize handle that snaps to them.**
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
  const [layout, setLayout] = useState<DashboardLayout>(() => defaultLayout());
  /** the store is only read after mount — SSR has no localStorage */
  const [ready, setReady] = useState(false);
  /**
   * ARRANGING, or reading.
   *
   * The board is LOCKED by default (user directive, 2026-08-29: "add a edit
   * button on top for moving hand and pins to become visible then a save and
   * they get fixed"). Everything that changes the arrangement — the drag, the
   * resize grips, the pins, remove, add, density — belongs to this mode, so
   * a board you are reading cannot be rearranged by a stray press, and the
   * things that would rearrange it are not even on screen.
   */
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLayout(readLayout());
    setReady(true);
  }, []);

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

  /**
   * PIN one card in place. Its job is inside edit mode: a pinned card is not
   * dragged and — the half that matters — is not SHOVED by a card you are
   * dragging past it, so settling the last tile cannot rearrange the three
   * you already settled.
   */
  const togglePin = (key: WidgetKey) =>
    update({
      ...layout,
      tiles: layout.tiles.map((tile) =>
        tile.key === key ? { ...tile, pinned: tile.pinned !== true } : tile),
    });

  /** one card's chrome — the chip, the title, the remove, and the drag grip */
  function Tile({ tile }: { tile: TilePlacement }) {
    const spec = specFor(tile.key);
    if (!spec) return null;
    const label = t(`widget.${spec.labelKey}` as "widget.records");
    const compact = layout.density === "compact";
    return (
      <section
        className={`tile group/card ${compact ? "p-3" : "p-4"}`}
        aria-label={label}
      >
        <header className="mb-2.5 flex items-center gap-3">
          <span className="tile-chip">{spec.icon}</span>
          <h2 className="min-w-0 flex-1 select-none truncate text-[0.95rem] font-semibold">
            {label}
          </h2>
          {/*
            The card's controls appear ONLY while the board is being edited:
            a pin and a remove. Outside edit mode there is nothing here at
            all — a control that is visible on a locked board is a control
            that does nothing when pressed.

            `data-nodrag` keeps a press here from becoming a drag — the
            engine's cancel list reads it.
          */}
          {editing ? (
            <>
              <button
                type="button"
                data-nodrag
                aria-pressed={tile.pinned === true}
                aria-label={tile.pinned === true ? t("unpin") : t("pin")}
                title={tile.pinned === true ? t("unpin") : t("pin")}
                className={`tile-remove tile-pin ${tile.pinned === true ? "is-pinned" : ""}`}
                onClick={() => togglePin(tile.key)}
              >
                <IconPin width={16} height={16} />
              </button>
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
            </>
          ) : null}
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
      case "stats": return <StatsWidget />;
      case "week": return <WeekWidget />;
      case "upcoming": return <UpcomingWidget size={size} />;
      case "records": return <RecordsMiniWidget size={size} />;
      case "calendar": return <CalendarWidget />;
      case "agents": return <AgentsWidget />;
      case "integrations": return <IntegrationsWidget />;
      case "record": return <StartRecordWidget />;
      default: return null;
    }
  }

  const onBoard = new Set(layout.tiles.map((tile) => tile.key));
  const hidden = WIDGET_SPECS.filter((spec) => !onBoard.has(spec.key));

  return (
    <div className="space-y-5">
      {/* ── the head: who, and the board's own controls ──────────────── */}
      {/*
        The ECHO LAUNCHER is gone (user directive, 2026-08-29: "remove the
        echo button from the top for now in dashboard"). The rail carries
        Echo on every screen, and a second door beside the greeting was
        competing with the board for the top of the page. Marked "for now" in
        their words, so the reason it left is on record if it comes back.
      */}
      {/*
        NO GREETING (user directive, 2026-08-29: "remove the hi amirreza at
        the top"). It went with its subtitle rather than leaving a stray line
        under a missing heading — they were one block saying one thing, and
        half of it is not a smaller version of it.

        What is left is the board's own control, aligned to the end. A person
        arriving here knows who they are; the tiles are what they came for.
      */}
      <div className="flex flex-wrap items-center justify-end gap-3">

        {/*
          READING, or ARRANGING. Everything that changes the board lives
          behind Edit: the density, the add menu, the pins, the remove
          buttons, the drag and the resize grips. Save is the way out, and it
          says "Save" rather than "Done" because what it does is fix the
          arrangement in place — which is the sentence the person used.
        */}
        <span className="flex items-center gap-2">
          {editing ? (
            <>
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
                              label: t(`widget.${spec.labelKey}` as "widget.records"),
                              icon: spec.icon,
                              onSelect: () => addWidget(spec.key),
                            })),
                        }),
                      )
                }
              />
              <button
                type="button"
                className="tap inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent hover:opacity-90"
                onClick={() => {
                  /* the layout is already stored on every change — Save
                     LOCKS it, which is the promise the button makes */
                  writeLayout(layout);
                  setEditing(false);
                }}
              >
                <IconCheck width={14} height={14} />
                {t("saveBoard")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="tap inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-fg-muted hover:text-fg"
              onClick={() => setEditing(true)}
            >
              <IconPencil width={14} height={14} />
              {t("editBoard")}
            </button>
          )}
        </span>
      </div>

      {/* ── the board ───────────────────────────────────────────────── */}
      {ready ? (
        <WidgetBoard
          layout={layout}
          locked={!editing}
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
