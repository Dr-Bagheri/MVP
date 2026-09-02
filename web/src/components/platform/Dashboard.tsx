"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconCheck, IconPencil, IconPin, IconTrash } from "@/components/icons";
import {
  defaultLayout, readLayout, writeLayout, specFor,
  type DashboardLayout, type TilePlacement, type TileSize, type WidgetKey,
} from "@/lib/dashboardLayout";
import { WidgetBoard } from "./dashboard/WidgetBoard";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import { personName } from "@/lib/format";
import { useLocale } from "next-intl";
import type { Me } from "@/api/types";
import {
  AgentsWidget, CalendarWidget, IntegrationsWidget, LatestMeetingsWidget, RecordsMiniWidget,
  StartRecordWidget, StatsWidget, UpcomingWidget, WeekWidget,
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
/**
 * The reference's greeting head (2026-09-01, "make it exactly like
 * theirs"): time-of-day salute with the person's name, the date with the
 * upcoming count in the same breath, and «شروع ضبط جلسه» — which opens the
 * new-meeting dialog with the CLICK MOMENT already in its time fields.
 */
function GreetingHead() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const hour = new Date().getHours();
  const salute = hour < 5 ? t("greetNight")
    : hour < 12 ? t("greetMorning")
      : hour < 16 ? t("greetNoon")
        : hour < 20 ? t("greetEvening")
          : t("greetNight");
  const name = me === null ? "" : personName(me, locale);

  return (
    /* the greeting and the board's own control share ONE row (user directive,
       2026-09-02: "make the title of the user name in the same row as the
       edit") — Edit sat on a line of its own under a two-line block, which
       spent a third row on a single button */
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {/* THE one large thing on this screen. The reference's dashboard has
            no page title and a 27px greeting: it is the only place in the
            product where a heading is allowed to be big, because it is the
            only place whose job is to greet rather than to label. */}
        <h1 className="text-3xl font-extrabold text-fg">
          {name === "" ? salute : t("greetWithName", { salute, name })} 👋
        </h1>
        {/* JUST THE GREETING (user directive, 2026-09-02: "remove the line
            under the username"). The next meeting was added here a round ago
            and asked to go a round later — and it reads better gone: the
            board already carries «پیش رو» as a panel, so the line was the
            same fact stated twice, once where nothing could be done with it. */}
      </div>
    </div>
  );
}

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
    /* a BARE widget brings its own cards; the board gives it the grid slot
       and nothing else. Its edit controls still have to reach it, so they
       ride an absolutely-positioned corner rather than a header row that
       would put the box back. */
    if (spec.bare === true) {
      return (
        /* overflow-hidden: a BARE tile brings its own cards and has no frame
           to scroll inside — if its content does not fit, the answer is a
           smaller card or a taller tile, never a scrollbar over a figure */
        <section className="group/card relative overflow-hidden" aria-label={label}>
          {editing ? (
            <span className="absolute end-1 top-1 z-10 flex gap-1">
              <button
                type="button" data-nodrag
                aria-pressed={tile.pinned === true}
                aria-label={tile.pinned === true ? t("unpin") : t("pin")}
                className={`tile-remove tile-pin ${tile.pinned === true ? "is-pinned" : ""}`}
                onClick={() => togglePin(tile.key)}
              >
                <IconPin width={16} height={16} />
              </button>
              <button
                type="button" data-nodrag
                aria-label={t("hide")}
                className="tile-remove"
                onClick={() => removeWidget(tile.key)}
              >
                <IconTrash width={16} height={16} />
              </button>
            </span>
          ) : null}
          {renderBody(tile.key, tile.size)}
        </section>
      );
    }
    return (
      <section
        className={`tile group/card ${compact ? "p-3" : "p-4"}`}
        aria-label={label}
      >
        {/*
          THE THEME'S PANEL HEADER (user directive, 2026-09-02): title and
          action on ONE row, with the hairline under them. The action used to
          be a link the widget drew on the line below its own title, which
          spent a whole row of a small card and put the first list item where
          the eye expected the second thing in the panel.
        */}
        <header className="mb-2.5 flex items-center gap-3 border-b border-border pb-2">
          <span className="tile-chip">{spec.icon}</span>
          <h2 className="min-w-0 flex-1 select-none truncate text-base font-semibold">
            {label}
          </h2>
          {spec.action !== undefined && !editing ? (
            <Link
              href={spec.action.href}
              className="shrink-0 whitespace-nowrap text-xs text-accent hover:underline"
            >
              {t(spec.action.labelKey as "upcomingAll")}
            </Link>
          ) : null}
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
      case "latest": return <LatestMeetingsWidget />;
      case "records": return <RecordsMiniWidget size={size} />;
      case "calendar": return <CalendarWidget />;
      case "agents": return <AgentsWidget />;
      case "integrations": return <IntegrationsWidget />;
      case "record": return <StartRecordWidget />;
      default: return null;
    }
  }

  return (
    <div className="space-y-5">
      {/* ONE ROW: the greeting and the board's own control (user directive,
          2026-09-02: "make the title of the user name in the same row as the
          edit"). Edit sat on a line of its own under a two-line block, which
          spent a third row of the page on a single button. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <GreetingHead />
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
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">

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
              {/*
                THE DENSITY TOGGLE AND THE ADD MENU ARE GONE (user directive,
                2026-09-02: "remove add card, remove compact and comfortable").
                Both were controls over the board's SHAPE, and the board has a
                shape now — the reference's, arrived at by measurement and
                signed off. A density switch offers two answers to a question
                that has one, and an add menu offers cards back onto a board
                somebody deliberately arranged.
                The catalogue and the layout engine are untouched: a widget
                still declares its sizes and a tile can still be pinned,
                dragged, resized and removed. What left is the two controls,
                not the machinery under them.
              */}
              <button
                type="button"
                className="btn btn-sm bg-accent font-semibold text-on-accent hover:opacity-90"
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
              className="btn btn-sm border border-border bg-surface text-fg-muted hover:text-fg"
              onClick={() => setEditing(true)}
            >
              <IconPencil width={14} height={14} />
              {t("editBoard")}
            </button>
          )}
        </span>
        </div>
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
