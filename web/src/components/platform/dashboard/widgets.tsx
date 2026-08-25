"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { Call } from "@/api/types";
import { Link } from "@/i18n/routing";
import { digits, formatDate, formatDuration } from "@/lib/format";
import { openAssistant } from "@/lib/assistantBus";
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
 */

export function TilesWidget({ data, expanded }: { data: DashboardData; expanded: boolean }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rows = data.calls ?? [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = rows.filter((c) => new Date(c.started_at).getTime() >= weekAgo);
  const minutes = Math.round(week.reduce((ms, c) => ms + (c.duration_ms ?? 0), 0) / 60_000);
  const processing = rows.filter((c) => c.status !== "ready" && c.status !== "failed").length;
  const value = (n: number) => (data.calls === null ? "—" : digits(n, locale));
  const tiles: [string, number][] = [
    [t("tileRecordsWeek"), week.length],
    [t("tileMinutes"), minutes],
    [t("tileProcessing"), processing],
    [t("tileActions"), data.actions.length],
  ];
  return (
    <div className={`grid gap-3 ${expanded ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
      {tiles.map(([label, n]) => (
        <div key={label} className="glass-tile rounded-xl p-3">
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
export function BriefingWidget({ data }: { data: DashboardData }) {
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
    <div>
      {text === null && !busy ? (
        <button className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => void generate()}>
          {t("briefingGenerate")}
        </button>
      ) : (
        <p dir="auto" className="whitespace-pre-wrap text-sm leading-8 text-fg">
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
export function AskWidget() {
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
        <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
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
export function PulseWidget({ data, expanded }: { data: DashboardData; expanded: boolean }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const days = expanded ? 30 : 14;
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
    <div>
      <div className="relative flex h-24 items-end gap-1">
        {buckets.map((b, i) => (
          <span key={i} className="group/bar relative flex-1" title={formatDate(b.date.toISOString(), locale)}>
            <span
              className={`block w-full rounded-t transition-[height] ${
                b.count === 0 ? "bg-surface-2" : "bg-accent/70 group-hover/bar:bg-accent"
              }`}
              style={{ height: `${Math.max(4, (b.count / maxCount) * 88)}px` }}
            />
            {/* the minutes line rides the same bars as a dot */}
            {b.minutes > 0 ? (
              <span
                className="absolute inset-x-0 mx-auto block h-1 w-1 rounded-full bg-info"
                style={{ bottom: `${Math.max(4, (b.minutes / maxMinutes) * 88) + 2}px` }}
                aria-hidden
              />
            ) : null}
          </span>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-3 text-[11px] text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent/70" aria-hidden /> {t("pulseBars")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden /> {t("pulseDots")}
        </span>
      </p>
    </div>
  );
}

/** commitments and decisions — the same shape, two sources */
export function LaneWidget({
  items, depth, empty, expanded, numbered = false,
}: {
  items: { text: string; callId: string; callTitle: string }[];
  depth: number;
  empty: string;
  expanded: boolean;
  numbered?: boolean;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const shown = items.slice(0, expanded ? 20 : 5);
  if (items.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{empty}</p>;
  }
  const List = numbered ? "ol" : "ul";
  return (
    <div>
      <List className={`space-y-2 ${numbered ? "list-inside list-decimal" : ""}`}>
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
      <p className="mt-3 text-[11px] text-fg-subtle">
        {t("laneDepth", { n: digits(depth, locale) })}
      </p>
    </div>
  );
}

export function TopicsWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  if (!data.tagsAvailable) {
    return <p className="text-sm leading-7 text-fg-muted">{t("topicsUnavailable")}</p>;
  }
  if (data.topics.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{t("topicsEmpty")}</p>;
  }
  return (
    <ul className="space-y-2">
      {data.topics.map((topic) => {
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

export function PeopleWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  if (data.appearances.length === 0) {
    return <p className="text-sm leading-7 text-fg-muted">{t("peopleEmpty")}</p>;
  }
  const top = data.appearances[0]!.records;
  return (
    <ul className="space-y-2">
      {data.appearances.slice(0, 6).map(({ person, records }) => (
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

export function PipelineWidget({ data }: { data: DashboardData }) {
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
    <ul className="space-y-2">
      {[...moving, ...failed].slice(0, 6).map((call) => (
        <li key={call.id} className="flex items-center justify-between gap-2">
          <Link href={`/calls/${call.id}`} className="min-w-0 truncate text-sm text-fg hover:text-accent">
            {call.title || "—"}
          </Link>
          <span className={`shrink-0 text-xs ${call.status === "failed" ? "text-danger" : "text-warning"}`}>
            {tStatus(call.status)}
          </span>
        </li>
      ))}
      <li className="pt-1 text-[11px] text-fg-subtle">
        {t("pipelineNote", { n: digits(moving.length + failed.length, locale) })}
      </li>
    </ul>
  );
}

/**
 * RECENT — with the live-arrival highlight: a record that appears between
 * two reads glows for a second instead of silently being there.
 */
export function RecentWidget({ data, expanded }: { data: DashboardData; expanded: boolean }) {
  const t = useTranslations("dashboard");
  const tCalls = useTranslations("calls");
  const locale = useLocale();
  const rows = (data.calls ?? []).slice().sort((a, b) => b.started_at.localeCompare(a.started_at));
  const shown = rows.slice(0, expanded ? 12 : 5);
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
    <ul className="divide-y divide-border">
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
