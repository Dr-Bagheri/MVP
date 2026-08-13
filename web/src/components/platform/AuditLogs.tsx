"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { BffError } from "@/api/client";
import { AUDIT_SOURCES } from "@echo/core/vocabulary";
import type { AuditCursor, AuditEntry, AuditSource, User } from "@/api/types";
import { Chip, EmptyState } from "@/components/ui";
import { digits, formatDate, formatTime } from "@/lib/format";

/**
 * Audit Logs (M25, Settings · COMPLIANCE) — one time-ordered feed over the
 * trail's three halves: admin actions, proposal decisions, assistant runs.
 *
 * ── Codes, never content ────────────────────────────────────────────────────
 *
 * The endpoint names every column it selects and deliberately never reads
 * `agent_run.request` or `agent_run.steps`, because those hold the prompt and
 * the tool trace — transcript excerpts and quoted documents. This screen keeps
 * that promise on its own side by rendering `detail` as labelled key/value
 * pairs rather than dumping the object: a `JSON.stringify` of whatever arrived
 * would faithfully display a content field the day one leaks in, and it would
 * look like a feature. The screen says WHAT HAPPENED. It is told nothing else,
 * and it is built so that showing something else would be a visible change
 * rather than an automatic one.
 *
 * ── Two things this screen deliberately does NOT do ─────────────────────────
 *
 * It does not resolve names. `actor_name` is joined server-side and arrives
 * with the entry; looking members up here would be a second place that maps
 * people to names, and two such places eventually disagree. A `null` there is
 * not "we couldn't find them" — core/ states it means the person was
 * tombstoned, their name emptied while the record they acted in survives. That
 * is a fact worth rendering in words, not a blank.
 *
 * It does not build cursors. `next_cursor` is opaque and goes back verbatim.
 * An earlier draft of this file paged on `entry.at + 1ms` with client-side
 * dedupe, to work around a cursor that filtered on the timestamp alone while
 * ordering by `(at, source, id)` — rows sharing an instant fell between pages
 * and vanished, and `now()` being transaction time in Postgres makes that tie
 * a certainty rather than a coincidence whenever one transaction writes two
 * audit rows. B1 replaced the cursor with the same three fields the ORDER BY
 * uses, so the workaround is gone and the whole class with it. What remains is
 * the rule that keeps it gone: **`cursor.at` is microsecond text and
 * `entry.at` is the millisecond value we display — never make one out of the
 * other.**
 */

/** One request's worth. The endpoint's own cap is 200. */
const PAGE = 50;

/** Ids are unique per SOURCE, not across the feed — the union hands back three
 *  tables' primary keys, so a React key needs both. */
const entryKey = (entry: AuditEntry) => `${entry.source}:${entry.id}`;

/**
 * Does this build know the source it was sent?
 *
 * Guards against deployment skew rather than drift — a server ahead of this
 * bundle. No type can prevent it, and the answer must never be "drop the row".
 */
const isKnownSource = (value: string): value is AuditSource =>
  (AUDIT_SOURCES as readonly string[]).includes(value);

/** `action` is a closed vocabulary for two of the three sources — and an open
 *  one for `admin_action`, whose values are whatever wrote them. Translating
 *  only what we know keeps an unrecognised code visible as a code instead of
 *  being mapped onto the nearest label that happens to exist. */
const TRANSLATABLE_ACTIONS: Record<string, readonly string[]> = {
  proposal_decision: ["approve", "reject"],
  agent_run: ["ok", "error", "running"],
};

const TRANSLATABLE_TARGETS = ["proposal", "agent_run", "member", "org", "call"];

/** Keys the three sources are known to build. Anything else renders under its
 *  raw name rather than being hidden — a detail we do not recognise is still a
 *  detail, and dropping it would be this screen editing the record. */
const TRANSLATABLE_DETAILS = [
  "kind", "model", "skill_id", "run_id", "tokens_in", "tokens_out", "error", "finished_at",
];

const SOURCE_TONE: Record<AuditSource, "accent" | "info" | "neutral"> = {
  admin_action: "accent",
  proposal_decision: "info",
  agent_run: "neutral",
};

export function AuditLogs() {
  const t = useTranslations("audit");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();

  const [me, setMe] = useState<User | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  /** Opaque. `null` means the feed is exhausted — core/'s reliable end signal,
   *  which a short page only happens to imply. */
  const [cursor, setCursor] = useState<AuditCursor | null>(null);
  const [source, setSource] = useState<AuditSource | "">("");
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [failed, setFailed] = useState<BffError | Error | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const page = await api.audit({ limit: PAGE, ...(source ? { source } : {}) });
      setEntries(page.entries);
      setCursor(page.next_cursor);
    } catch (error) {
      setFailed(error as Error);
      /*
       * Rows are CLEARED on failure. Leaving the previous page on screen under
       * an error banner would show a stale feed that reads as current — and on
       * this surface "these are the events" is the entire claim being made.
       */
      setEntries([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setPaging(true);
    try {
      // handed back exactly as received — see the header
      const page = await api.audit({ limit: PAGE, cursor, ...(source ? { source } : {}) });
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.next_cursor);
    } catch (error) {
      setFailed(error as Error);
    } finally {
      setPaging(false);
    }
  }, [cursor, source]);

  /**
   * Who acted — and `null` says something specific.
   *
   * core/ resolves the name at read time and returns `null` only when the
   * actor no longer exists (M24's true delete empties the person and keeps the
   * row so references still resolve). So this renders a stated fact, not a
   * failed lookup, and it keeps the id visible because the id is the thing that
   * still links the record together.
   */
  const actorCell = (entry: AuditEntry) =>
    entry.actor_name ? (
      <span className="font-medium text-fg">{entry.actor_name}</span>
    ) : (
      <span className="text-fg-muted" title={t("actorRemovedNote")}>
        <span className="block text-xs">{t("actorRemoved")}</span>
        <span className="ltr block font-mono text-[11px] text-fg-muted/80">
          {entry.actor_id.slice(0, 8)}
        </span>
      </span>
    );

  const actionLabel = (entry: AuditEntry) =>
    TRANSLATABLE_ACTIONS[entry.source]?.includes(entry.action) ? (
      <span className="text-fg">{t(`action.${entry.action}`)}</span>
    ) : (
      <span className="ltr font-mono text-xs text-fg">{entry.action}</span>
    );

  const targetCell = (entry: AuditEntry) => (
    <>
      {TRANSLATABLE_TARGETS.includes(entry.target_type) ? (
        <span className="text-fg-muted">{t(`target.${entry.target_type}`)}</span>
      ) : (
        <span className="ltr font-mono text-xs text-fg-muted">{entry.target_type}</span>
      )}
      {entry.target_id ? (
        <span className="ltr block font-mono text-[11px] text-fg-muted/80">
          {entry.target_id.slice(0, 8)}
        </span>
      ) : null}
    </>
  );

  /**
   * `detail`, as labelled pairs — never as a dumped object.
   *
   * `null` values are dropped because the producer builds a fixed set of keys
   * per source and fills the ones that apply: a null `error` on a successful
   * run is the absence of an error, not a fact worth a row. A zero is NOT
   * dropped — `tokens_out: 0` is a measurement, and the "not measured must
   * never render as zero" rule cuts both ways.
   */
  const detailPairs = (entry: AuditEntry) =>
    Object.entries(entry.detail).filter(([, value]) => value !== null && value !== undefined);

  const detailValue = (key: string, value: unknown) => {
    if (key === "finished_at" && typeof value === "string") {
      return `${formatDate(value, locale)} ${formatTime(value, locale)}`;
    }
    if (typeof value === "number") return digits(value, locale);
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  /*
   * `me === null` renders nothing rather than the refusal: identity in flight
   * and identity refused are different states, and showing an admin a locked
   * door for 200ms teaches them the product doubts them.
   */
  if (me !== null && !isAdmin) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-sm font-medium text-fg">{tAdmin("adminOnly")}</p>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("adminOnlyNote")}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs leading-6 text-fg-muted">{t("codesOnly")}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label>
          <span className="sr-only">{t("filterSource")}</span>
          <select
            className="input h-11 min-h-0 w-auto py-0 text-sm md:h-10"
            value={source}
            onChange={(event) => setSource(event.target.value as AuditSource | "")}
          >
            <option value="">{t("filterAll")}</option>
            {AUDIT_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`source.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3">
          <p className="text-sm font-medium text-fg">{t("failed")}</p>
          <button
            className="btn-secondary mt-2 h-9 min-h-0 px-3 text-xs"
            onClick={() => void load()}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-fg-muted">{t("loading")}</p>
      ) : entries.length === 0 && !failed ? (
        <EmptyState text={source ? t("emptyFiltered") : t("empty")} />
      ) : entries.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="table-head py-2 pe-3">{t("colWhen")}</th>
                  <th className="table-head py-2 pe-3">{t("colWho")}</th>
                  <th className="table-head py-2 pe-3">{t("colWhat")}</th>
                  <th className="table-head py-2 pe-3">{t("colTarget")}</th>
                  <th className="table-head py-2">{t("colDetail")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => {
                  const known = isKnownSource(entry.source);
                  return (
                    <tr key={entryKey(entry)}>
                      <td className="py-3 pe-3 align-top text-xs text-fg-muted">
                        <span className="block">{formatDate(entry.at, locale)}</span>
                        <span className="block">{formatTime(entry.at, locale)}</span>
                      </td>
                      <td className="py-3 pe-3 align-top">{actorCell(entry)}</td>
                      <td className="py-3 pe-3 align-top">
                        {/*
                          An unknown source is RENDERED, never skipped. A build
                          that quietly dropped entries it did not recognise
                          would make a deployment skew look like an
                          organization where nothing happened — and the entries
                          most likely to be new are the ones most worth seeing.
                        */}
                        {known ? (
                          <Chip tone={SOURCE_TONE[entry.source]}>
                            {t(`source.${entry.source}`)}
                          </Chip>
                        ) : (
                          <span title={t("unknownSourceNote")}>
                            <Chip tone="warning">{t("unknownSource")}</Chip>
                            <span className="ltr mt-1 block font-mono text-[11px] text-fg-muted">
                              {entry.source}
                            </span>
                          </span>
                        )}
                        <span className="mt-1 block text-xs">{actionLabel(entry)}</span>
                      </td>
                      <td className="py-3 pe-3 align-top text-xs">{targetCell(entry)}</td>
                      <td className="py-3 align-top">
                        <ul className="space-y-0.5">
                          {detailPairs(entry).map(([key, value]) => (
                            <li key={key} className="text-xs text-fg-muted">
                              <span>
                                {TRANSLATABLE_DETAILS.includes(key) ? (
                                  t(`detail.${key}`)
                                ) : (
                                  <span className="ltr font-mono">{key}</span>
                                )}
                              </span>
                              <span>: </span>
                              <span className="ltr font-mono text-fg">
                                {detailValue(key, value)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {cursor ? (
              <button
                className="btn-secondary h-10 min-h-0 px-4 text-sm"
                disabled={paging}
                onClick={() => void loadMore()}
              >
                {paging ? t("loading") : t("loadMore")}
              </button>
            ) : (
              <p className="text-xs text-fg-muted">{t("atEnd")}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
