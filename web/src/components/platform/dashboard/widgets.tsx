"use client";

import { useEffect, useRef, useState } from "react";
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
  const all: [string, number][] = [
    [t("tileRecordsWeek"), week.length],
    [t("tileMinutes"), minutes],
    [t("tileProcessing"), processing],
    [t("tileActions"), data.actions.length],
  ];
  /* `wide` is one row tall: two numbers fit, four would be four small
     numbers nobody reads. The tier drops tiles rather than shrinking them. */
  const tiles = size === "wide" ? all.slice(0, 2) : all;
  return (
    <div className={`grid h-full gap-3 ${size === "wide" ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-4"}`}>
      {tiles.map(([label, n]) => (
        <div key={label} className="glass-tile flex flex-col justify-center rounded-xl p-3">
          <p className="text-xs text-fg-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold text-fg">{value(n)}</p>
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

  if (data.calls !== null && data.calls.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{t("noRecords")}</p>;
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
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
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
          <p className="mt-2 flex items-center gap-2 text-[11px] text-fg-subtle">
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

/** the fortnight's shape: bars for records, a line for minutes */
export function PulseWidget({ data, size }: { data: DashboardData; size: TileSize }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  /* the RANGE is what grows with the tier — same bars, more history */
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
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const maxMinutes = Math.max(1, ...buckets.map((b) => b.minutes));
  return (
    <div className="flex h-full flex-col justify-end">
      <div className={`relative flex items-end gap-1 ${isShort(size) ? "h-14" : "h-24"}`}>
        {buckets.map((b, i) => (
          <span key={i} className="group/bar relative flex-1" title={formatDate(b.date.toISOString(), locale)}>
            <span
              className={`block w-full rounded-t transition-[height] ${
                b.count === 0 ? "bg-surface-2" : "bg-accent/70 group-hover/bar:bg-accent"
              }`}
              style={{ height: `${Math.max(4, (b.count / maxCount) * (isShort(size) ? 48 : 88))}px` }}
            />
            {/* the minutes line rides the same bars as a dot */}
            {b.minutes > 0 ? (
              <span
                className="absolute inset-x-0 mx-auto block h-1 w-1 rounded-full bg-info"
                style={{ bottom: `${Math.max(4, (b.minutes / maxMinutes) * (isShort(size) ? 48 : 88)) + 2}px` }}
                aria-hidden
              />
            ) : null}
          </span>
        ))}
      </div>
      {/* the legend is the tier's extra layer — at one row tall the bars
          have to speak for themselves */}
      {isShort(size) ? null : (
        <p className="mt-2 flex items-center gap-3 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-accent/70" aria-hidden /> {t("pulseBars")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden /> {t("pulseDots")}
          </span>
        </p>
      )}
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
    return <p className="text-sm leading-7 text-fg-muted">{empty}</p>;
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
              className="ms-2 text-[11px] text-fg-subtle underline-offset-2 hover:text-accent hover:underline"
            >
              {item.callTitle || "—"}
            </Link>
          </li>
        ))}
      </List>
      {isShort(size) ? null : (
        <p className="mt-3 text-[11px] text-fg-subtle">
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
    return <p className="text-sm leading-7 text-fg-muted">{t("topicsUnavailable")}</p>;
  }
  if (data.topics.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{t("topicsEmpty")}</p>;
  }
  return (
    <ul className="h-full space-y-2 overflow-y-auto">
      {data.topics.slice(0, rowsFor(size)).map((topic) => {
        const delta = topic.now - topic.before;
        return (
          <li key={topic.tag} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-fg">{topic.tag}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              <span className="text-fg-muted">{digits(topic.now, locale)}</span>
              {delta !== 0 ? (
                <span className={delta > 0 ? "text-success" : "text-fg-subtle"}>
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
    return <p className="text-sm leading-7 text-fg-muted">{t("peopleEmpty")}</p>;
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
          <span className="w-6 shrink-0 text-end text-xs text-fg-muted">{digits(records, locale)}</span>
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
  if (data.calls === null) return <p className="text-sm text-fg-muted">…</p>;
  if (failed.length === 0 && moving.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
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
        <li className="pt-1 text-[11px] text-fg-subtle">
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

  if (data.calls === null) return <p className="text-sm text-fg-muted">…</p>;
  if (shown.length === 0) return <p className="text-sm leading-7 text-fg-muted">{t("noRecords")}</p>;
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
            <span className="shrink-0 text-xs text-fg-subtle">
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
        <p className="flex-1 text-sm leading-7 text-fg-muted">{t("watchEmpty")}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {counted.slice(0, rowsFor(size)).map(({ term, hits, where }) => (
            <li key={term} className="group/w flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-fg" dir="auto">{term}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {hits > 0 && where[0] ? (
                  <Link
                    href={`/calls/${where[0].callId}`}
                    className="text-fg-subtle underline-offset-2 hover:text-accent hover:underline"
                  >
                    {digits(hits, locale)}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">{digits(0, locale)}</span>
                )}
                <button
                  type="button"
                  aria-label={t("watchRemove", { term })}
                  className="tap grid h-6 w-6 place-items-center rounded text-fg-subtle opacity-0 hover:text-danger group-hover/w:opacity-100"
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
        <p className="mt-2 text-[11px] text-fg-subtle">
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

  if (data.calls === null) return <p className="text-sm text-fg-muted">…</p>;
  if (withDecisions.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{t("decisionsEmpty")}</p>;
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
              <span className="text-[11px] text-fg-subtle">{formatDate(record.at, locale)}</span>
            </p>
            <ul className="mt-1 space-y-1">
              {record.decisions.slice(0, size === "hero" ? 4 : 2).map((text, i) => (
                <li key={i} dir="auto" className="text-sm leading-7 text-fg-muted">{text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-fg-subtle">{t("ledgerNote")}</p>
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
        <p className="flex-1 text-xs leading-6 text-fg-muted">{t("nextHint")}</p>
      ) : last === undefined ? (
        <p className="flex-1 text-xs leading-6 text-fg-muted">{t("nextNone")}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="flex flex-wrap items-baseline gap-2">
            <Link href={`/calls/${last.callId}`} className="text-xs font-semibold text-fg hover:text-accent">
              {last.callTitle || "—"}
            </Link>
            <span className="text-[11px] text-fg-subtle">{formatDate(last.at, locale)}</span>
          </p>
          {last.decisions.length + last.actions.length === 0 ? (
            <p className="mt-1 text-xs leading-6 text-fg-muted">{t("nextNothingAgreed")}</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {[...last.decisions, ...last.actions]
                .slice(0, size === "large" ? 5 : 2)
                .map((text, i) => (
                  <li key={i} dir="auto" className="text-sm leading-7 text-fg-muted">{text}</li>
                ))}
            </ul>
          )}
        </div>
      )}
      {isShort(size) ? null : (
        <p className="text-[11px] text-fg-subtle">{t("nextNoCalendar")}</p>
      )}
    </div>
  );
}
