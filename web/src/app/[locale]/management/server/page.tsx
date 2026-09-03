"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentStats, ServerHealth, User } from "@/api/types";
import { SettingsPane } from "@/components/platform/SettingsPane";
import { PageHeader, Skeleton } from "@/components/scaffold";
import { DataTable } from "@/components/DataTable";
import { Card } from "@/components/ui";
import { digits, formatTime } from "@/lib/format";

/**
 * Server management (M25) — **wired**, and built around one rule.
 *
 * ── Not measured must never render as zero ──────────────────────────────────
 *
 * Every metric carries its own `measured_at`. A null there means *we did not
 * find out*; a real zero arrives WITH a timestamp. So nothing on this screen
 * asks whether a value is falsy — it asks whether the metric was MEASURED, and
 * renders "—" when it wasn't.
 *
 * That distinction is the whole reason this page is careful. "0 failing jobs"
 * is the most dangerous thing an operations screen can display, because it
 * reads as healthy and someone acts on it. A zero we measured and a zero we
 * invented look identical once rendered, and only one of them is true.
 *
 * The trap worth naming, because it is what a reasonable implementation does:
 * `value || "—"` satisfies every test written against the storage row (whose
 * value is genuinely null) while being *wrong* on the keys row (whose zero is
 * real). `keys.active === 0` with a timestamp is the case that tells a working
 * rule from a broken one, so it is asserted beside the storage case rather
 * than after it.
 *
 * ── Metrics answer independently ────────────────────────────────────────────
 *
 * core/ always returns 200 with per-metric status: one unreadable source must
 * not blank three working ones. So the "not measured" marker lives on the ROW,
 * never on the page. A page-level "not connected" banner over three live
 * numbers is the same lie pointed the other way — it understates what is
 * healthy.
 *
 * ── The frame stands first (audit finding, 2026-09-02) ──────────────────────
 *
 * The three metric cards and the governance card render on the FIRST paint,
 * with a skeleton the size of each number while its read is in flight. They
 * used to exist only once `health` arrived, so the page assembled itself in
 * front of the reader — heading, a gap, then three cards dropping in — and
 * the governance card showed a bare "…" that reads as *this tile is broken*,
 * not *this tile is coming*. Structure is known before the network; only the
 * values wait. A read that FAILS leaves the same frame standing with "—" in
 * every slot, because a metric we could not fetch is a metric we did not
 * measure — the banner above the cards names why.
 *
 * ── Three names rendered literally, because they were chosen carefully ──────
 *
 * - **`retrying` is not "dead letters".** pgmq has no dead-letter queue; this
 *   counts messages read three or more times without completing. The page's
 *   earlier copy promised "dead letters" and that promise is now GONE: a label
 *   that makes a correct number wrong is worse than no label.
 * - **`archived` is not a failure count.** pgmq's archive holds successes too,
 *   so it is throughput, not an alarm. Deliberately not coloured as one.
 * - **`storage.bytes` stays null until someone grants it.** `echo_app` is
 *   refused the whole `storage` schema, and the server's `unavailable`
 *   sentence names the fix rather than leaving a blank to be puzzled over.
 *
 * Provider health (transcription, model) was named on this page's earlier
 * "what will appear here" list and is deliberately absent: the endpoint does
 * not measure it, and a row that cannot be filled is a promise, not a metric.
 */

/** Human-readable size. Unexercised today — `bytes` is null until a grant
 *  lands — which is exactly why a test covers it: a branch that never renders
 *  is a branch that ships wrong. */
function formatBytes(bytes: number, locale: string, unit: (key: string) => string): string {
  const units = ["unitB", "unitKB", "unitMB", "unitGB"] as const;
  let value = bytes;
  let step = 0;
  while (value >= 1024 && step < units.length - 1) {
    value /= 1024;
    step += 1;
  }
  // one decimal above bytes; a fractional byte is noise
  const shown = step === 0 ? String(value) : value.toFixed(1);
  return `${digits(shown, locale)} ${unit(units[step]!)}`;
}

export default function ServerManagementPage() {
  const t = useTranslations("management");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();

  const [me, setMe] = useState<User | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  /** Phase C: agent governance aggregates — null until loaded, "failed" is its own state */
  const [agentStats, setAgentStats] = useState<AgentStats | null | "failed">(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setHealth(await api.serverHealth());
    } catch {
      setFailed(true);
      // cleared rather than left stale: an operations number under an error
      // banner is still a number someone reads and acts on
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    /* separate source, separate failure: stats breaking must not blank the
       health cards (this page's own one-broken-source rule), and vice versa */
    void Promise.resolve()
      .then(() => api.agentStats())
      .then(setAgentStats)
      .catch(() => setAgentStats("failed"));
  }, [isAdmin, load]);

  /**
   * The answer this render may show: none while a read is in flight (a value
   * from an earlier read under a fresh skeleton would be the stale number the
   * catch above clears), none after a failed one. Everything below reads
   * `answered`, never `health`, so the two cannot disagree about it.
   */
  const answered: ServerHealth | null = loading ? null : health;
  /** the governance source, with its own two nothings folded to one for the
   *  slots — "failed" keeps its sentence on the card itself */
  const stats: AgentStats | null = agentStats === null || agentStats === "failed" ? null : agentStats;

  /**
   * The "—" every honest gap on this page renders.
   *
   * `reason` is the server's own sentence when it sent one. It is shown as an
   * LTR technical line rather than folded into the Persian copy on purpose:
   * it names the fix for whoever can apply it (a grant), and it is the
   * server's wording, not ours to translate and let drift.
   */
  const NotMeasured = ({ reason }: { reason?: string | undefined }) => (
    <span>
      <span className="text-fg-muted" title={t("server.notMeasuredHint")}>
        —
      </span>
      <span className="sr-only">{t("server.notMeasured")}</span>
      {reason ? (
        <span className="ltr mt-1 block font-mono text-[11px] text-fg-muted/80">{reason}</span>
      ) : null}
    </span>
  );

  /** A count, but only if it was measured. Keyed on `measured_at` — never on
   *  the number being falsy, which is the bug this page exists to avoid. */
  const count = (metric: { measured_at: string | null }, value: number | null) =>
    metric.measured_at !== null && value !== null ? (
      <span className="text-fg">{digits(value, locale)}</span>
    ) : (
      <NotMeasured />
    );

  /**
   * A metric's value slot has three states and they are decided HERE, once
   * (audit finding, 2026-09-02): the read is in flight → a skeleton the size
   * of the figure; the read failed → "—" (not fetched is not measured); the
   * read answered → the value, through `count`'s measured-or-dash rule.
   */
  const slot = (render: (h: ServerHealth) => ReactNode) =>
    loading ? <Skeleton className="h-7 w-16" /> : answered === null ? <NotMeasured /> : render(answered);

  const measuredAt = (at: string | null) =>
    /* the timestamp line is reserved while the read is in flight — it is
       part of the card's height, and a line that appears after the answer
       moves everything under it */
    loading ? (
      <Skeleton className="mt-2 h-3 w-40" />
    ) : at === null ? null : (
      <p className="mt-2 text-[11px] text-fg-muted">
        {t("server.measuredAt", { time: formatTime(at, locale) })}
      </p>
    );

  /**
   * One governance figure: label, headline number, caption. While the stats
   * source is in flight both the number and its caption are skeletons in
   * their own sizes (audit finding, 2026-09-02: the card showed a bare "…").
   * The headline goes through `digits()` like every other number on this
   * page — four raw JS numbers were rendering Latin digits on the Persian
   * screen beside the queue counts that did not.
   */
  const figure = (
    label: string,
    value: (s: AgentStats) => ReactNode,
    caption: (s: AgentStats) => string,
    valueClass = "",
  ) => (
    <div>
      <p className="text-fg-muted">{label}</p>
      {stats === null ? (
        <>
          <Skeleton className="mt-1 h-6 w-12" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </>
      ) : (
        <>
          <p className={`text-xl font-bold text-fg ${valueClass}`}>{value(stats)}</p>
          <p className="text-xs text-fg-subtle">{caption(stats)}</p>
        </>
      )}
    </div>
  );

  if (me !== null && !isAdmin) {
    return (
      /* the refusal keeps the pane — losing the menu would strand a member on
         a dead end beside sections they may open */
      <SettingsPane activeSlug="server">
        <PageHeader title={t("section.server")} />
        <Card>
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane activeSlug="server">
      <div>
        <PageHeader title={t("section.server")} subtitle={t("desc.server")} />

        {failed ? (
          <Card className="mb-4 border-danger/40 bg-danger/10">
            <p className="text-sm font-medium text-fg">{t("server.failed")}</p>
            {/* audit finding, 2026-09-02: `.btn-sm` IS the compact control; the
                h-9/min-h-0/px-3/text-xs it wore re-answered the height `.btn`
                exists to answer, and made a 36px button nothing else has */}
            <button className="btn-secondary btn-sm mt-2" onClick={() => void load()}>
              {t("server.retry")}
            </button>
          </Card>
        ) : null}

        {/* THE FRAME STANDS FIRST (audit finding, 2026-09-02): every card below
            renders on the first paint and only its values wait — see the
            header. Nothing here is gated on `health`. */}
        <Card className="mb-4">
          <h2 className="h-section mb-3">{t("server.queuesTitle")}</h2>
          {!loading && (answered === null || answered.queues.measured_at === null) ? (
            <NotMeasured reason={answered?.queues.unavailable} />
          ) : (
            /* THE PLATFORM'S TABLE (audit finding, 2026-09-02): this was
               the one hairline-collapsed grid left in the product —
               beside the members list it read as a different product.
               Unpaged on purpose: the queue set is bounded by
               construction (one row per pgmq queue) and belongs on
               screen whole. `loading` reserves the table's own frame with
               skeleton rows — one per queue the dev project reports — and
               `empty` is the honest "no queues" sentence, which DataTable
               withholds while the read is in flight. (A JS comment, not a
               JSX one: an expression container is not valid as a ternary's
               bare consequent.) */
            <DataTable
              rows={answered?.queues.items ?? []}
              loading={loading}
              loadingRows={4}
              rowKey={(queue) => queue.name}
              pageSize={null}
              empty={<p className="text-sm text-fg-muted">{t("server.noQueues")}</p>}
              columns={[
                {
                  key: "name", header: t("server.colQueue"),
                  cell: (queue) => <span className="ltr font-mono text-xs text-fg">{queue.name}</span>,
                },
                { key: "depth", header: t("server.colDepth"), cell: (queue) => digits(queue.depth, locale) },
                {
                  key: "retrying", header: t("server.colRetrying"),
                  /* the only value here that warrants attention — and only
                     when it is non-zero. `retrying` counts work that keeps
                     failing; `archived` counts work that finished,
                     successfully or not, so it is never coloured as an alarm. */
                  cell: (queue) => (
                    <span className={queue.retrying > 0 ? "font-semibold text-warning" : "text-fg"}
                      title={t("server.retryingHint")}>
                      {digits(queue.retrying, locale)}
                    </span>
                  ),
                },
                {
                  key: "archived", header: t("server.colArchived"), className: "text-fg-muted",
                  cell: (queue) => <span title={t("server.archivedHint")}>{digits(queue.archived, locale)}</span>,
                },
              ]}
            />
          )}
          {measuredAt(answered?.queues.measured_at ?? null)}
        </Card>

        {/* audit finding, 2026-09-02: one scale role for every stat figure on
            this page — `text-xl font-bold text-fg`, the page-title step. These
            were `text-2xl`, larger than the page's own name in the breadcrumb,
            while the governance figures below used text-xl for the same kind
            of number: two sizes for one role on one screen. */}
        <Card className="mb-4">
          <h2 className="h-section mb-3">{t("server.keysTitle")}</h2>
          <dl className="flex flex-wrap gap-8">
            <div>
              <dt className="text-xs text-fg-muted">{t("server.keysActive")}</dt>
              <dd className="mt-1 text-xl font-bold text-fg">
                {slot((h) => count(h.keys, h.keys.active))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t("server.keysRevoked")}</dt>
              <dd className="mt-1 text-xl font-bold text-fg">
                {slot((h) => count(h.keys, h.keys.revoked))}
              </dd>
            </div>
          </dl>
          {answered !== null && answered.keys.measured_at === null ? (
            <NotMeasured reason={answered.keys.unavailable} />
          ) : null}
          {measuredAt(answered?.keys.measured_at ?? null)}
        </Card>

        <Card>
          <h2 className="h-section mb-3">{t("server.storageTitle")}</h2>
          <dl>
            <dt className="text-xs text-fg-muted">{t("server.storageBytes")}</dt>
            <dd className="mt-1 text-xl font-bold text-fg">
              {slot((h) =>
                h.storage.measured_at !== null && h.storage.bytes !== null ? (
                  <span className="text-fg">
                    {formatBytes(h.storage.bytes, locale, (key) => t(`server.${key}`))}
                  </span>
                ) : (
                  <NotMeasured reason={h.storage.unavailable} />
                ),
              )}
            </dd>
          </dl>
          {measuredAt(answered?.storage.measured_at ?? null)}
        </Card>

        {/* Phase C: the governance view — agent activity as numbers an
            admin can act on. Counts and sums only; briefs render as
            "—" when signals are not migrated (not measured ≠ zero). Its
            source is separate from `health`, so it is gated on neither
            the health read nor its failure. */}
        <Card className="mt-4">
          <h2 className="h-section">{t("server.agentTitle")}</h2>
          {agentStats === "failed" ? (
            <p className="mt-1 text-sm text-fg-muted">{t("server.agentUnavailable")}</p>
          ) : (
            <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {figure(
                t("server.agentRuns"),
                (s) => digits(s.runs.total, locale),
                (s) => t("server.agentFailed", { count: s.runs.failed }),
              )}
              {figure(
                t("server.agentTokens"),
                (s) => digits(s.runs.tokens_out, locale),
                (s) => t("server.agentPeople", { count: s.runs.people }),
                "ltr",
              )}
              {figure(
                t("server.agentApprovals"),
                (s) => digits(s.decisions.approved, locale),
                (s) => t("server.agentRejected", { count: s.decisions.rejected }),
              )}
              {figure(
                t("server.agentBriefs"),
                (s) => (s.cards ? digits(s.cards.delivered, locale) : "—"),
                (s) =>
                  s.cards
                    ? t("server.agentBriefsRead", { count: s.cards.read })
                    : t("server.agentBriefsUnmeasured"),
              )}
            </div>
          )}
        </Card>
      </div>
    </SettingsPane>
  );
}
