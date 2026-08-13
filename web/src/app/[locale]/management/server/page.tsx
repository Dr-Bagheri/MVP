"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ServerHealth, User } from "@/api/types";
import { ManagementPane } from "@/components/platform/ManagementPane";
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
  }, [isAdmin, load]);

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

  const measuredAt = (at: string | null) =>
    at === null ? null : (
      <p className="mt-2 text-[11px] text-fg-muted">
        {t("server.measuredAt", { time: formatTime(at, locale) })}
      </p>
    );

  if (me !== null && !isAdmin) {
    return (
      /* the refusal keeps the pane — losing the menu would strand a member on
         a dead end beside sections they may open */
      <ManagementPane activeSlug="server">
        <h1 className="mb-1 text-xl font-bold text-fg">{t("section.server")}</h1>
        <Card className="mt-4">
          <h2 className="h-section">{tAdmin("adminOnly")}</h2>
          <p className="mt-1 text-sm leading-7 text-fg-muted">{tAdmin("adminOnlyNote")}</p>
        </Card>
      </ManagementPane>
    );
  }

  return (
    <ManagementPane activeSlug="server">
      <div>
        <h1 className="mb-1 text-xl font-bold text-fg">{t("section.server")}</h1>
        <p className="mb-5 text-sm leading-7 text-fg-muted">{t("desc.server")}</p>

        {failed ? (
          <Card className="mb-4 border-danger/40 bg-danger/10">
            <p className="text-sm font-medium text-fg">{t("server.failed")}</p>
            <button
              className="btn-secondary mt-2 h-9 min-h-0 px-3 text-xs"
              onClick={() => void load()}
            >
              {t("server.retry")}
            </button>
          </Card>
        ) : null}

        {loading ? <p className="text-sm text-fg-muted">{t("server.loading")}</p> : null}

        {health ? (
          <>
            <Card className="mb-4">
              <h2 className="h-section mb-3">{t("server.queuesTitle")}</h2>
              {health.queues.measured_at === null ? (
                <NotMeasured reason={health.queues.unavailable} />
              ) : health.queues.items.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("server.noQueues")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="table-head py-2 pe-3">{t("server.colQueue")}</th>
                        <th className="table-head py-2 pe-3">{t("server.colDepth")}</th>
                        <th className="table-head py-2 pe-3" title={t("server.retryingHint")}>
                          {t("server.colRetrying")}
                        </th>
                        <th className="table-head py-2" title={t("server.archivedHint")}>
                          {t("server.colArchived")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {health.queues.items.map((queue) => (
                        <tr key={queue.name}>
                          <td className="ltr py-3 pe-3 font-mono text-xs text-fg">{queue.name}</td>
                          <td className="py-3 pe-3 text-fg">{digits(queue.depth, locale)}</td>
                          {/* the only value here that warrants attention — and
                              only when it is non-zero. `retrying` counts work
                              that keeps failing; `archived` counts work that
                              finished, successfully or not, so it is never
                              coloured as an alarm. */}
                          <td
                            className={`py-3 pe-3 ${queue.retrying > 0 ? "font-semibold text-warning" : "text-fg"}`}
                          >
                            {digits(queue.retrying, locale)}
                          </td>
                          <td className="py-3 text-fg-muted">{digits(queue.archived, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {measuredAt(health.queues.measured_at)}
            </Card>

            <Card className="mb-4">
              <h2 className="h-section mb-3">{t("server.keysTitle")}</h2>
              <dl className="flex flex-wrap gap-8">
                <div>
                  <dt className="text-xs text-fg-muted">{t("server.keysActive")}</dt>
                  <dd className="mt-1 text-2xl font-bold">
                    {count(health.keys, health.keys.active)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{t("server.keysRevoked")}</dt>
                  <dd className="mt-1 text-2xl font-bold">
                    {count(health.keys, health.keys.revoked)}
                  </dd>
                </div>
              </dl>
              {health.keys.measured_at === null ? (
                <NotMeasured reason={health.keys.unavailable} />
              ) : null}
              {measuredAt(health.keys.measured_at)}
            </Card>

            <Card>
              <h2 className="h-section mb-3">{t("server.storageTitle")}</h2>
              <dl>
                <dt className="text-xs text-fg-muted">{t("server.storageBytes")}</dt>
                <dd className="mt-1 text-2xl font-bold">
                  {health.storage.measured_at !== null && health.storage.bytes !== null ? (
                    <span className="text-fg">
                      {formatBytes(health.storage.bytes, locale, (key) => t(`server.${key}`))}
                    </span>
                  ) : (
                    <NotMeasured reason={health.storage.unavailable} />
                  )}
                </dd>
              </dl>
              {measuredAt(health.storage.measured_at)}
            </Card>
          </>
        ) : null}
      </div>
    </ManagementPane>
  );
}
