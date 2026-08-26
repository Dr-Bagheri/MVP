"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call } from "@/api/types";
import { Link } from "@/i18n/routing";
import { digits, formatDate, formatDuration } from "@/lib/format";
import { openAssistant } from "@/lib/assistantBus";
import { SelectMenu } from "@/components/rowActions";
import type { TileSize } from "@/lib/dashboardLayout";
import type { DashboardData } from "./useDashboardData";

/**
 * The dashboard's widgets. Each is a pure reader over `DashboardData` (or,
 * for the two AI ones, over the agent's own stream) — the grid owns
 * placement, they own content.
 *
 * The house rules they all keep:
 *   · not-fetched renders «—», never a confident zero;
 *   · anything the AGENT wrote carries a source line and a confidence edge
 *     (the 2026 pattern: an AI block that cannot say where it came from is
 *     a block nobody should act on);
 *   · every derived lane says how deep it read.
 *
 * And the rule that arrived with the four tile sizes (2026-08-26): the tier
 * is a PROP, and a bigger tier is ADDITIVE — the same subject with more of
 * it, never the same content stretched. Each widget below reads `size` and
 * appends rows, a chart, a footnote; none of them measures itself, and none
 * of them changes what it is about between tiers.
 */

/**
 * A read that did not land says SO. A dash means "we have not counted yet"
 * and resolves on its own; a failure never will, so a tile that keeps
 * showing the dash is a tile that lies by waiting.
 */
export function Unreadable({ children }: { children?: ReactNode }) {
  const t = useTranslations("dashboard");
  return (
    <p className="ink-muted flex items-center gap-2 text-sm leading-7">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
      {children ?? t("readFailed")}
    </p>
  );
}

/** how many list rows a tier has room for — the one place the ladder lives */
export function rowsFor(size: TileSize): number {
  return { small: 3, wide: 3, large: 6, hero: 12 }[size];
}
/** the two SHORT tiers: one row tall, so no footnote and no second block */
export function isShort(size: TileSize): boolean {
  return size === "small" || size === "wide";
}

export function TilesWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rows = data.calls ?? [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = rows.filter((c) => new Date(c.started_at).getTime() >= weekAgo);
  const minutes = Math.round(week.reduce((ms, c) => ms + (c.duration_ms ?? 0), 0) / 60_000);
  const processing = rows.filter((c) => c.status !== "ready" && c.status !== "failed").length;
  const value = (n: number) => (data.calls === null ? "—" : digits(n, locale));
  if (data.failed) return <Unreadable />;
  const all: [string, number][] = [
    [t("tileRecordsWeek"), week.length],
    [t("tileMinutes"), minutes],
    [t("tileProcessing"), processing],
    [t("tileActions"), data.actions.length],
  ];
  /**
   * The tier DROPS tiles rather than shrinking them, and it lays them in
   * ONE row at every size. The previous version wrapped to two rows at
   * `hero`, which needed more height than the tier has — the numbers
   * spilled out of the bottom of the card, which is the bug that made
   * "resize it and the content disappears" true.
   */
  const tiles = size === "wide" ? all.slice(0, 2) : all;
  return (
    <div className={`grid h-full min-h-0 gap-2.5 ${size === "wide" ? "grid-cols-2" : "grid-cols-4"}`}>
      {tiles.map(([label, n]) => (
        <div
          key={label}
          /* on a gradient tile the inner cells are frosted panes rather
             than bordered boxes — a hairline over a wash reads as a seam */
          className="tile-cell flex flex-col justify-center p-3"
        >
          <p className="ink-muted truncate text-[11px] leading-snug">{label}</p>
          <p className={`mt-1 font-bold leading-none tabular-nums ${
            size === "wide" ? "text-[1.6rem]" : "text-[2rem]"
          }`}>{value(n)}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * THE BRIEFING — the agent speaking first. Generated ONCE a day (cached by
 * date) rather than on every paint: a landing page that spends a model run
 * per visit is a landing page nobody can afford to open.
 */
export function BriefingWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = `neurai-briefing:${new Date().toISOString().slice(0, 10)}`;
  const asked = useRef(false);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(key);
      if (cached) setText(cached);
    } catch { /* storage unavailable — the button still works */ }
  }, [key]);

  async function generate(): Promise<void> {
    if (busy || data.calls === null) return;
    setBusy(true);
    setFailed(false);
    setText("");
    let out = "";
    try {
      const stream = api.ask(t("briefingPrompt"), { page: "/", callIds: [] }, undefined, { locale });
      for await (const event of stream) {
        if (event.type === "text_delta") {
          out += event.delta;
          setText(out);
        }
        if (event.type === "done" && event.failed) setFailed(true);
      }
      if (out.trim()) {
        try { localStorage.setItem(key, out); } catch { /* fine */ }
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /* the FIRST visit of the day generates it; later visits read the cache */
  useEffect(() => {
    if (asked.current || text !== null || data.calls === null || data.calls.length === 0) return;
    asked.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [data.calls, text]);

  if (data.failed) return <Unreadable />;
  if (data.calls !== null && data.calls.length === 0) {
    return <p className="text-sm leading-7 ink-muted">{t("noRecords")}</p>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {text === null && !busy ? (
        <button className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => void generate()}>
          {t("briefingGenerate")}
        </button>
      ) : (
        <p
          dir="auto"
          className={`min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-fg ${
            size === "hero" ? "text-base leading-9" : "text-sm leading-8"
          }`}
        >
          {text}
          {busy ? <span className="ms-1 inline-block h-4 w-2 animate-pulse bg-accent align-middle" /> : null}
        </p>
      )}
      {failed ? <p className="mt-2 text-xs text-warning">{t("briefingFailed")}</p> : null}
      {/* WHY you are seeing this + how to reset it — the 2026 rule for any
          adaptive block, and the source line that makes it checkable */}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] ink-subtle">
        <span>{t("briefingWhy", { n: digits(data.laneDepth, locale) })}</span>
        <button
          className="underline-offset-2 hover:text-fg hover:underline"
          onClick={() => { try { localStorage.removeItem(key); } catch { /* fine */ } void generate(); }}
        >
          {t("regenerate")}
        </button>
      </p>
    </div>
  );
}

/** ASK — the answer arrives as a block on the dashboard, not as chat text. */
export function AskWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(): Promise<void> {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setAnswer("");
    let out = "";
    try {
      const stream = api.ask(q, { page: "/", callIds: [] }, undefined, { locale });
      for await (const event of stream) {
        if (event.type === "text_delta") {
          out += event.delta;
          setAnswer(out);
        }
      }
      if (!out.trim()) setAnswer(null);
    } catch {
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void ask(); }}
      >
        <input
          className="input flex-1"
          placeholder={t("askPlaceholder")}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn-primary h-11 min-h-0 px-4 text-sm md:h-10" disabled={busy}>
          {busy ? "…" : t("askGo")}
        </button>
      </form>
      {answer !== null ? (
        <div className={`overflow-y-auto rounded-xl border border-accent/30 bg-accent-soft/40 p-3 ${
          size === "hero" ? "max-h-56" : "max-h-24"
        }`}>
          <p dir="auto" className="whitespace-pre-wrap text-sm leading-7 text-fg">{answer}</p>
          <p className="mt-2 flex items-center gap-2 text-[11px] ink-subtle">
            <span>{t("askWhy")}</span>
            <button
              className="underline-offset-2 hover:text-fg hover:underline"
              onClick={() => openAssistant({ draft: question })}
            >
              {t("askContinue")}
            </button>
            <button
              className="underline-offset-2 hover:text-fg hover:underline"
              onClick={() => setAnswer(null)}
            >
              {t("askDismiss")}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * ACTIVITY — a real chart rather than a row of bars.
 *
 * Drawn as one SVG with a `viewBox`, so it scales to whatever the tier
 * gives it instead of being measured in pixels the tile may not have. Four
 * layers, each doing a job the bars could not:
 *
 *   · a faint baseline grid, so a height means something;
 *   · minutes as a smooth AREA with a gradient falling to nothing, which
 *     is the shape people read as "volume over time";
 *   · records as slim columns underneath it, so the two series are
 *     distinguishable without a legend having to explain them;
 *   · an emphasised endpoint — the most recent day gets a dot and its
 *     value, because "where are we now" is the question a trend is asked.
 */
export function PulseWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  /* the RANGE grows with the tier — same chart, more history */
  const days = { small: 7, wide: 14, large: 21, hero: 45 }[size];
  const rows = data.calls ?? [];
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (days - 1 - i));
    const from = day.getTime();
    const to = from + 24 * 3600 * 1000;
    const inDay = rows.filter((c) => {
      const at = new Date(c.started_at).getTime();
      return at >= from && at < to;
    });
    return {
      date: day,
      count: inDay.length,
      minutes: inDay.reduce((ms, c) => ms + (c.duration_ms ?? 0), 0) / 60_000,
    };
  });

  if (data.failed) return <Unreadable />;

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const maxMinutes = Math.max(1, ...buckets.map((b) => b.minutes));

  /* the drawing space. Nothing here is a pixel: the SVG scales. */
  const W = 100;
  const H = 42;
  const PAD = 3;
  const step = buckets.length > 1 ? (W - PAD * 2) / (buckets.length - 1) : 0;
  const x = (i: number) => PAD + i * step;
  const y = (v: number, max: number) => H - PAD - (v / max) * (H - PAD * 2);

  /**
   * A CATMULL-ROM spline converted to cubic béziers. A polyline through
   * daily counts reads as jagged noise; a curve reads as a trend, which is
   * what the card is for. The tension keeps it from overshooting into
   * negative territory on a spike, which would draw minutes nobody spent.
   */
  const curve = (points: { cx: number; cy: number }[]): string => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0]!.cx} ${points[0]!.cy}`;
    let d = `M ${points[0]!.cx} ${points[0]!.cy}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;
      const c1x = p1.cx + (p2.cx - p0.cx) / 6;
      const c1y = p1.cy + (p2.cy - p0.cy) / 6;
      const c2x = p2.cx - (p3.cx - p1.cx) / 6;
      const c2y = p2.cy - (p3.cy - p1.cy) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.cx.toFixed(2)} ${p2.cy.toFixed(2)}`;
    }
    return d;
  };

  const points = buckets.map((b, i) => ({ cx: x(i), cy: y(b.minutes, maxMinutes) }));
  const line = curve(points);
  const area = points.length > 1
    ? `${line} L ${x(points.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`
    : "";
  const last = buckets.at(-1);
  const lastPoint = points.at(-1);
  /* one id per instance — two charts on one board must not share a gradient */
  const gid = `pulse-${size}-${buckets.length}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={t("widget.pulse")}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* the baseline grid — three rules, so a height is readable */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={PAD} x2={W - PAD}
              y1={PAD + (H - PAD * 2) * f} y2={PAD + (H - PAD * 2) * f}
              stroke="currentColor"
              strokeOpacity="0.09"
              strokeWidth="0.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* records started, as slim columns under the area */}
          {buckets.map((b, i) => (
            b.count > 0 ? (
              <rect
                key={i}
                x={x(i) - Math.max(0.7, step * 0.22)}
                width={Math.max(1.4, step * 0.44)}
                y={y(b.count, maxCount)}
                height={Math.max(0.8, H - PAD - y(b.count, maxCount))}
                rx="0.7"
                fill="currentColor"
                fillOpacity="0.22"
              />
            ) : null
          ))}

          {/* minutes recorded, as the area and its edge */}
          {area ? <path d={area} fill={`url(#${gid})`} /> : null}
          {line ? (
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.95"
            />
          ) : null}

          {/* the endpoint — "where are we now" is the question a trend asks */}
          {lastPoint ? (
            <>
              <circle cx={lastPoint.cx} cy={lastPoint.cy} r="3.2"
                      fill="currentColor" fillOpacity="0.18" />
              <circle cx={lastPoint.cx} cy={lastPoint.cy} r="1.5" fill="currentColor" />
            </>
          ) : null}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-3 text-[11px] ink-subtle">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-3.5 rounded-full bg-current opacity-90" aria-hidden />
            {t("pulseDots")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-1.5 rounded-[1px] bg-current opacity-30" aria-hidden />
            {t("pulseBars")}
          </span>
        </p>
        {isShort(size) || !last ? null : (
          <p className="text-[11px] ink-subtle">
            {t("pulseRange", { n: digits(days, locale) })}
          </p>
        )}
      </div>
    </div>
  );
}

/** commitments and decisions — the same shape, two sources */
export function LaneWidget({
  items, depth, empty, size, numbered = false,
}: {
  items: { text: string; callId: string; callTitle: string }[];
  depth: number;
  empty: string;
  size: TileSize;
  numbered?: boolean;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const shown = items.slice(0, rowsFor(size));
  if (items.length === 0) {
    return <p className="text-sm leading-7 ink-muted">{empty}</p>;
  }
  const List = numbered ? "ol" : "ul";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <List className={`min-h-0 flex-1 space-y-2 overflow-y-auto ${numbered ? "list-inside list-decimal" : ""}`}>
        {shown.map((item, i) => (
          <li key={i} className="text-sm leading-7 text-fg">
            {!numbered ? <input type="checkbox" className="me-2 align-middle" aria-label={item.text} /> : null}
            <span dir="auto">{item.text}</span>
            <Link
              href={`/calls/${item.callId}`}
              className="ms-2 text-[11px] ink-subtle underline-offset-2 hover:text-accent hover:underline"
            >
              {item.callTitle || "—"}
            </Link>
          </li>
        ))}
      </List>
      {isShort(size) ? null : (
        <p className="mt-3 text-[11px] ink-subtle">
          {t("laneDepth", { n: digits(depth, locale) })}
        </p>
      )}
    </div>
  );
}

export function TopicsWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  if (!data.tagsAvailable) {
    return <p className="text-sm leading-7 ink-muted">{t("topicsUnavailable")}</p>;
  }
  if (data.topics.length === 0) {
    return <p className="text-sm leading-7 ink-muted">{t("topicsEmpty")}</p>;
  }
  return (
    <ul className="h-full space-y-2 overflow-y-auto">
      {data.topics.slice(0, rowsFor(size)).map((topic) => {
        const delta = topic.now - topic.before;
        return (
          <li key={topic.tag} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-fg">{topic.tag}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              <span className="ink-muted">{digits(topic.now, locale)}</span>
              {delta !== 0 ? (
                <span className={delta > 0 ? "text-success" : "ink-subtle"}>
                  {delta > 0 ? "▲" : "▼"}{digits(Math.abs(delta), locale)}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PeopleWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  if (data.appearances.length === 0) {
    return <p className="text-sm leading-7 ink-muted">{t("peopleEmpty")}</p>;
  }
  const top = data.appearances[0]!.records;
  return (
    <ul className="h-full space-y-2 overflow-y-auto">
      {data.appearances.slice(0, rowsFor(size)).map(({ person, records }) => (
        <li key={person.id} className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg">
            {person.display_name.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{person.display_name}</span>
          <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(records / top) * 100}%` }} />
          </span>
          <span className="w-6 shrink-0 text-end text-xs ink-muted">{digits(records, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PipelineWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("status");
  const locale = useLocale();
  const rows = data.calls ?? [];
  const failed = rows.filter((c) => c.status === "failed");
  const moving = rows.filter((c) => c.status !== "ready" && c.status !== "failed");
  if (data.failed) return <Unreadable />;
  if (data.calls === null) return <p className="text-sm ink-muted">…</p>;
  if (failed.length === 0 && moving.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm ink-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
        {t("pipelineClear")}
      </p>
    );
  }
  return (
    <ul className="h-full space-y-2 overflow-y-auto">
      {[...moving, ...failed].slice(0, rowsFor(size)).map((call) => (
        <li key={call.id} className="flex items-center justify-between gap-2">
          <Link href={`/calls/${call.id}`} className="min-w-0 truncate text-sm text-fg hover:text-accent">
            {call.title || "—"}
          </Link>
          <span className={`shrink-0 text-xs ${call.status === "failed" ? "text-danger" : "text-warning"}`}>
            {tStatus(call.status)}
          </span>
        </li>
      ))}
      {isShort(size) ? null : (
        <li className="pt-1 text-[11px] ink-subtle">
          {t("pipelineNote", { n: digits(moving.length + failed.length, locale) })}
        </li>
      )}
    </ul>
  );
}

/**
 * RECENT — with the live-arrival highlight: a record that appears between
 * two reads glows for a second instead of silently being there.
 */
export function RecentWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const tCalls = useTranslations("calls");
  const locale = useLocale();
  const rows = (data.calls ?? []).slice().sort((a, b) => b.started_at.localeCompare(a.started_at));
  const shown = rows.slice(0, rowsFor(size));
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (data.calls === null) return;
    const ids = new Set(data.calls.map((c) => c.id));
    if (seen.current === null) { seen.current = ids; return; } // the first read is not an arrival
    const arrived = [...ids].filter((id) => !seen.current!.has(id));
    seen.current = ids;
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const timer = setTimeout(() => setFresh(new Set()), 1400);
    return () => clearTimeout(timer);
  }, [data.calls]);

  if (data.failed) return <Unreadable />;
  if (data.calls === null) return <p className="text-sm ink-muted">…</p>;
  if (shown.length === 0) return <p className="text-sm leading-7 ink-muted">{t("noRecords")}</p>;
  return (
    <ul className="h-full divide-y divide-border overflow-y-auto">
      {shown.map((call: Call) => (
        <li
          key={call.id}
          className={`py-2 transition-colors duration-700 first:pt-0 last:pb-0 ${
            fresh.has(call.id) ? "rounded-lg bg-accent-soft px-2" : ""
          }`}
        >
          <Link href={`/calls/${call.id}`} className="group flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-fg group-hover:text-accent">
              {call.title.trim() === "" ? tCalls("untitled") : call.title}
            </span>
            <span className="shrink-0 text-xs ink-subtle">
              {call.duration_ms !== null
                ? formatDuration(call.duration_ms / 1000, locale)
                : formatDate(call.started_at, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * WATCHLIST — words YOU chose, counted across the records the dashboard
 * read, with the record each hit came from one tap away.
 *
 * The difference from the topics card is the whole point: topics counts the
 * tags the product DISCOVERED, this counts terms a person named — a
 * competitor, a product, a phrase that means trouble. Gong and Fireflies
 * both ship this and both find it is the thing people actually configure.
 *
 * Two honesty rules it keeps:
 *  · it counts over the DEEP READ only, and says so — a count over "the
 *    newest six records" is a different number from a count over the org's
 *    history, and reporting the first as the second is the kind of lie a
 *    dashboard tells fluently;
 *  · it matches WHOLE WORDS, never substrings. A short Persian term inside
 *    a longer word is a false-positive factory this repo has already been
 *    bitten by («دی» matching inside «محمدی»).
 *
 * INTERIM store: the terms live in localStorage, per browser, for the same
 * reason the layout does — a watchlist is a personal convenience until the
 * preferences slot carries it.
 */
const WATCH_KEY = "neurai-watchlist";

function watchTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/‌/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean),
  );
}

export function WatchlistWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [terms, setTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (raw) setTerms(JSON.parse(raw) as string[]);
    } catch { /* storage unavailable — the widget still adds in-session */ }
  }, []);

  function save(next: string[]): void {
    setTerms(next);
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* fine */ }
  }

  /* one pass over the read bodies, per term, whole-word */
  const counted = terms.map((term) => {
    const want = [...watchTokens(term)];
    let hits = 0;
    const where: { callId: string; callTitle: string }[] = [];
    for (const record of data.records) {
      const said = watchTokens(record.body);
      if (want.length > 0 && want.every((token) => said.has(token))) {
        hits += 1;
        where.push({ callId: record.callId, callTitle: record.callTitle });
      }
    }
    return { term, hits, where };
  }).sort((a, b) => b.hits - a.hits);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {terms.length === 0 ? (
        <p className="flex-1 text-sm leading-7 ink-muted">{t("watchEmpty")}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {counted.slice(0, rowsFor(size)).map(({ term, hits, where }) => (
            <li key={term} className="group/w flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-fg" dir="auto">{term}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {hits > 0 && where[0] ? (
                  <Link
                    href={`/calls/${where[0].callId}`}
                    className="ink-subtle underline-offset-2 hover:text-accent hover:underline"
                  >
                    {digits(hits, locale)}
                  </Link>
                ) : (
                  <span className="ink-subtle">{digits(0, locale)}</span>
                )}
                <button
                  type="button"
                  aria-label={t("watchRemove", { term })}
                  className="tap grid h-6 w-6 place-items-center rounded ink-subtle opacity-0 hover:text-danger group-hover/w:opacity-100"
                  onClick={() => save(terms.filter((x) => x !== term))}
                >
                  <span aria-hidden className="text-xs">✕</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const term = draft.trim();
          if (!term || terms.includes(term)) return;
          save([...terms, term].slice(0, 12));
          setDraft("");
        }}
      >
        <input
          className="input h-8 min-h-0 flex-1 py-0 text-xs"
          placeholder={t("watchAdd")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
      {isShort(size) ? null : (
        <p className="mt-2 text-[11px] ink-subtle">
          {t("watchNote", { n: digits(data.laneDepth, locale) })}
        </p>
      )}
    </div>
  );
}

/**
 * DECISION LEDGER — the decisions in the records, IN TIME.
 *
 * The decisions lane answers "what was decided lately"; this answers "when
 * did we decide it", which is the question that sends someone back to
 * re-listen. Grouped by record, newest first, each on a timeline spine.
 *
 * What it deliberately does NOT do: flag one decision as reversing another.
 * That needs a model pass and a human confirmation step, and a wrong "these
 * contradict" is worse than no ledger at all — it re-opens a settled
 * question on the strength of a guess. The footnote says the detection is
 * absent rather than leaving the silence to be read as "nothing conflicts".
 */
export function LedgerWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const withDecisions = data.records
    .filter((r) => r.decisions.length > 0)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));

  if (data.failed) return <Unreadable />;
  if (data.calls === null) return <p className="text-sm ink-muted">…</p>;
  if (withDecisions.length === 0) {
    return <p className="text-sm leading-7 ink-muted">{t("decisionsEmpty")}</p>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {withDecisions.slice(0, size === "hero" ? 8 : 4).map((record) => (
          <li key={record.callId} className="relative ps-4">
            {/* the spine: a ledger reads as a timeline, or it is just a list */}
            <span className="absolute inset-y-1 start-0 w-px bg-border" aria-hidden />
            <span className="absolute start-[-2px] top-2 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <p className="flex flex-wrap items-baseline gap-2">
              <Link
                href={`/calls/${record.callId}`}
                className="text-xs font-semibold text-fg hover:text-accent"
              >
                {record.callTitle || "—"}
              </Link>
              <span className="text-[11px] ink-subtle">{formatDate(record.at, locale)}</span>
            </p>
            <ul className="mt-1 space-y-1">
              {record.decisions.slice(0, size === "hero" ? 4 : 2).map((text, i) => (
                <li key={i} dir="auto" className="text-sm leading-7 ink-muted">{text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] ink-subtle">{t("ledgerNote")}</p>
    </div>
  );
}

/**
 * NEXT MEETING — what you agreed with these people last time.
 *
 * The version every meeting product ships reads your CALENDAR and prepares
 * the next appointment by itself. **We have no calendar integration**, and
 * inventing one is not on the table, so this is the honest half: pick the
 * person you are about to meet and it recalls your last record with them —
 * its decisions and the commitments that came out of it. The note says the
 * calendar half is missing, rather than letting an empty tile imply you
 * have nothing coming up.
 */
export function NextWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [personId, setPersonId] = useState("");

  /* only people who actually appear in the read records can be recalled */
  const candidates = data.directory.filter((p) =>
    data.records.some((r) => r.personIds.includes(p.id)));
  const last = personId
    ? data.records
        .filter((r) => r.personIds.includes(personId))
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))[0]
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <SelectMenu
        className="h-8 min-h-0 w-full py-0 text-xs"
        ariaLabel={t("nextPick")}
        value={personId}
        onChange={setPersonId}
        options={[
          { value: "", label: t("nextPick") },
          ...candidates.map((p) => ({ value: p.id, label: p.display_name })),
        ]}
      />
      {personId === "" ? (
        /* the hint is the LARGE tier's extra layer — at two rows the
           picker is the whole card, and a wrapped sentence under it
           overflows into the tile below */
        isShort(size)
          ? null
          : <p className="flex-1 text-xs leading-6 ink-muted">{t("nextHint")}</p>
      ) : last === undefined ? (
        <p className="flex-1 text-xs leading-6 ink-muted">{t("nextNone")}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="flex flex-wrap items-baseline gap-2">
            <Link href={`/calls/${last.callId}`} className="text-xs font-semibold text-fg hover:text-accent">
              {last.callTitle || "—"}
            </Link>
            <span className="text-[11px] ink-subtle">{formatDate(last.at, locale)}</span>
          </p>
          {last.decisions.length + last.actions.length === 0 ? (
            <p className="mt-1 text-xs leading-6 ink-muted">{t("nextNothingAgreed")}</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {[...last.decisions, ...last.actions]
                .slice(0, size === "large" ? 5 : 2)
                .map((text, i) => (
                  <li key={i} dir="auto" className="text-sm leading-7 ink-muted">{text}</li>
                ))}
            </ul>
          )}
        </div>
      )}
      {isShort(size) ? null : (
        <p className="text-[11px] ink-subtle">{t("nextNoCalendar")}</p>
      )}
    </div>
  );
}

/**
 * TEAM — the directory's teams, as a share of the people you actually
 * meet. Uses `person.team` from db/0096, which only exists once that
 * migration has run: an org that has not labelled anyone gets the honest
 * line rather than a chart of one slice called "no team".
 */
export function TeamWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const counted = new Map<string, number>();
  for (const { person, records } of data.appearances) {
    const team = person.team ?? "";
    counted.set(team, (counted.get(team) ?? 0) + records);
  }
  const rows = [...counted.entries()]
    .filter(([team]) => team !== "")
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);

  if (data.appearances.length === 0) {
    return <p className="ink-muted text-sm leading-7">{t("peopleEmpty")}</p>;
  }
  if (rows.length === 0) {
    return <p className="ink-muted text-sm leading-7">{t("teamEmpty")}</p>;
  }
  return (
    <ul className="h-full space-y-2.5 overflow-y-auto">
      {rows.slice(0, rowsFor(size)).map(([team, n]) => (
        <li key={team}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{team}</span>
            <span className="ink-subtle shrink-0 text-xs tabular-nums">
              {digits(Math.round((n / total) * 100), locale)}%
            </span>
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-current/15" aria-hidden>
            <span
              className="block h-full rounded-full bg-current"
              style={{ width: `${(n / total) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * AGENT — the two doors into the assistant, as a card rather than a menu
 * row. A dashboard whose only route to the agent is the rail is a
 * dashboard that hides its most capable feature behind an icon.
 */
export function AgentWidget({ size }: { size: TileSize }) {
  const t = useTranslations("dashboard");
  const suggestions = [
    t("agentAsk1"),
    t("agentAsk2"),
    t("agentAsk3"),
  ].slice(0, size === "large" ? 3 : 2);
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          dir="auto"
          className="tap rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-start text-xs leading-6 ink-muted transition-colors hover:border-accent hover:text-fg"
          onClick={() => openAssistant({ draft: text })}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
