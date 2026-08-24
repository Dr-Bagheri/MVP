"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import type { Call, SummaryVersion } from "@/api/types";
import { Link } from "@/i18n/routing";
import { Card, EmptyState } from "@/components/ui";
import { formatDate, formatRelativeDate } from "@/lib/format";
import { SummaryBody } from "./SummaryBody";

/**
 * Echo · Summaries (user directive, 2026-08-21: "add a summary section
 * that can show different recordings' summaries").
 *
 * A reading surface, not a new source of truth: the list is the same
 * records list, narrowed to the ones that HAVE a summary; selecting one
 * fetches its stored versions through the same client path the record's
 * own detail page uses. The record's page remains the full home (audio,
 * transcript, versions) — this section is the shortcut for "just read me
 * the outcomes".
 */
export function SummariesSection() {
  const t = useTranslations("summaries");
  const locale = useLocale();
  /** `null` = not fetched; `[]` = genuinely none */
  const [records, setRecords] = useState<Call[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<SummaryVersion[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const callsEpoch = useRefreshEpoch("calls");
  useEffect(() => {
    void api.listCalls().then((rows) => {
      // only records whose pipeline produced a summary have one to show
      const withSummaries = rows.filter((row) => row.current_summary_id !== null);
      setRecords(withSummaries);
      setSelected((current) => current ?? withSummaries[0]?.id ?? null);
    }).catch(() => setRecords([]));
  }, [callsEpoch]);

  useEffect(() => {
    if (!selected) return;
    setVersions(null);
    setLoadFailed(false);
    void api.getSummaries(selected)
      .then(setVersions)
      .catch(() => setLoadFailed(true));
  }, [selected]);

  const current = versions?.[0] ?? null;

  if (records === null) return null;
  if (records.length === 0) {
    return (
      <Card>
        <EmptyState
          text={t("empty")}
          action={
            <Link href="/echo" className="btn-primary h-10 min-h-0 px-5 text-sm">
              {t("emptyAction")}
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <div className="space-y-1.5">
        {records.map((record) => (
          <button
            key={record.id}
            type="button"
            className={`tap block w-full rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
              record.id === selected
                ? "border-accent/40 bg-accent-soft text-fg"
                : "border-border text-fg-muted hover:text-fg"
            }`}
            onClick={() => setSelected(record.id)}
          >
            <span className="block font-medium">{record.title ?? t("untitled")}</span>
            <span
              className="mt-0.5 block text-xs text-fg-subtle"
              title={formatDate(record.started_at, locale)}
            >
              {formatRelativeDate(record.started_at, locale)}
            </span>
          </button>
        ))}
      </div>

      <Card>
        {loadFailed ? (
          <p role="alert" className="text-sm text-danger">{t("loadFailed")}</p>
        ) : versions === null ? null : current === null ? (
          <p className="text-sm text-fg-muted">{t("none")}</p>
        ) : (
          <>
            {/* summaries are Persian by ruling (M6) — direction pinned so an
                English UI does not flip the paragraph; rendered as a
                DOCUMENT (chapters bold, paragraphs smaller — 2026-08-24) */}
            <div dir="rtl" className="text-sm">
              <SummaryBody text={current.body} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-fg-subtle">
              <span>{t("version", { version: current.version })}</span>
              <span>{formatDate(current.created_at, locale)}</span>
              {selected ? (
                <Link href={`/calls/${selected}`} className="text-accent underline-offset-2 hover:underline">
                  {t("openRecord")}
                </Link>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
