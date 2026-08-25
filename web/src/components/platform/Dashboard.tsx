"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCardItem, Call, Me } from "@/api/types";
import { Link } from "@/i18n/routing";
import { digits, formatDate, personName } from "@/lib/format";
import { openAssistant } from "@/lib/assistantBus";
import { useRefreshEpoch } from "@/lib/refreshBus";

/**
 * THE DASHBOARD — the platform's landing page (user directive, 2026-08-25:
 * "from now on the dashboard should be our landing page").
 *
 * It answers one question on arrival: *what happened while I was away, and
 * what wants me now.* Everything on it is derived from what the wire
 * already serves — records, the assistant's signal cards, the roster — so
 * no tile is a promise: a number that cannot be computed renders as «—»
 * (the history_since rule), never as a confident zero.
 *
 * AI-native means the assistant is present as an ACTION, not as a widget:
 * every block can be handed to the dock with a question already drafted,
 * and the signals lane is the agent speaking first.
 */
export function Dashboard() {
  const t = useTranslations("dashboard");
  const tCalls = useTranslations("calls");
  const locale = useLocale();

  const [me, setMe] = useState<Me | null>(null);
  /** null = not fetched yet — the tiles say «—» rather than «۰» */
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [cards, setCards] = useState<AgentCardItem[]>([]);
  const callsEpoch = useRefreshEpoch("calls");

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(() => {
    void api.listCalls({ includeArchived: false })
      .then((rows) => setCalls(rows.filter((c) => c.deleted_at === null)))
      .catch(() => setCalls([]));
    void api.cards().then((res) => setCards(res.cards)).catch(() => setCards([]));
  }, [callsEpoch]);

  const rows = calls ?? [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const thisWeek = rows.filter((c) => new Date(c.started_at).getTime() >= weekAgo);
  const minutes = Math.round(
    thisWeek.reduce((ms, c) => ms + (c.duration_ms ?? 0), 0) / 60_000);
  const unread = cards.filter((c) => !c.read).length;
  const processing = rows.filter(
    (c) => c.status !== "ready" && c.status !== "failed").length;
  const recent = rows.slice().sort((a, b) => b.started_at.localeCompare(a.started_at));

  /** records per day for the last 14 — the week's shape, not a claim */
  const spark = Array.from({ length: 14 }, (_, i) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (13 - i));
    const next = day.getTime() + 24 * 3600 * 1000;
    return rows.filter((c) => {
      const at = new Date(c.started_at).getTime();
      return at >= day.getTime() && at < next;
    }).length;
  });
  const sparkMax = Math.max(1, ...spark);

  const tile = (label: string, value: number) => (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-fg">
        {calls === null ? "—" : digits(value, locale)}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* the greeting: who, and when — the same personName resolver the hub
          uses, so a Latin-named person is greeted as they wrote themselves */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold leading-tight text-fg">
            {me ? t("greeting", { name: personName(me, locale) }) : t("greetingPlain")}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          className="btn-secondary h-9 min-h-0 px-3 text-xs"
          onClick={() => openAssistant({ draft: t("askDraft") })}
        >
          {t("askAbout")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tile(t("tileRecordsWeek"), thisWeek.length)}
        {tile(t("tileMinutes"), minutes)}
        {tile(t("tileProcessing"), processing)}
        {tile(t("tileSignals"), unread)}
      </div>

      {/* the fortnight's shape — bars, not a number: an empty stretch is
          information too, and a chart says it without claiming a trend */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="mb-3 text-xs font-semibold text-fg-muted">{t("activity")}</p>
        <div className="flex h-20 items-end gap-1.5" aria-hidden>
          {spark.map((n, i) => (
            <span
              key={i}
              className={`flex-1 rounded-t transition-[height] ${
                n === 0 ? "bg-surface-2" : "bg-accent/70"
              }`}
              style={{ height: `${Math.max(6, (n / sparkMax) * 100)}%` }}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">{t("activityNote")}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* the freshest records — the thing people come back for */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">{t("recent")}</h2>
            <Link href="/echo/records" className="text-xs text-accent underline-offset-2 hover:underline">
              {t("seeAll")}
            </Link>
          </div>
          {calls === null ? (
            <p className="text-sm text-fg-muted">…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm leading-7 text-fg-muted">{t("noRecords")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.slice(0, 5).map((c) => (
                <li key={c.id} className="py-2 first:pt-0 last:pb-0">
                  <Link href={`/calls/${c.id}`} className="group flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-fg group-hover:text-accent">
                      {c.title.trim() === "" ? tCalls("untitled") : c.title}
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {formatDate(c.started_at, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* the agent speaking FIRST — its unread briefs, opened in the dock
            where the conversation that produced them already lives */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-fg">{t("signals")}</h2>
          {cards.length === 0 ? (
            <p className="text-sm leading-7 text-fg-muted">{t("noSignals")}</p>
          ) : (
            <ul className="space-y-1.5">
              {cards.slice(0, 5).map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    className={`tap block w-full rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
                      card.read
                        ? "border-border text-fg-muted hover:text-fg"
                        : "border-accent/40 bg-accent-soft text-fg"
                    }`}
                    onClick={() => {
                      if (card.session_id) openAssistant({ sessionId: card.session_id });
                    }}
                  >
                    {!card.read ? (
                      <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden />
                    ) : null}
                    <span className="align-middle">{card.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
