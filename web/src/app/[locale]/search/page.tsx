"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { SearchHit } from "@/api/types";
import { DataTable, type Column } from "@/components/DataTable";
import { PlatformShell } from "@/components/platform/PlatformShell";
/* the `<mark>` whitelist is SHARED with the top bar's box (2026-09-08) —
   a parser for untrusted transcript text is not a thing to have twice */
import { Snippet } from "@/components/platform/SearchSnippet";
import { PageContainer, PageHeader } from "@/components/scaffold";
import { Card, Chip, EmptyState } from "@/components/ui";
import { IconCopy, IconOpen } from "@/components/icons";
import { digits, formatClock, formatDate } from "@/lib/format";
import { notify } from "@/lib/notify";

/** DataTable wants a per-row key; hits have none, so position provides it */
type HitRow = SearchHit & { rowId: string };

export default function SearchPage() {
  const t = useTranslations("search");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setHits(await api.search(query));
    setBusy(false);
  }

  const rows: HitRow[] = (hits ?? []).map((hit, i) => ({ ...hit, rowId: String(i) }));

  /* the RECORDS-table anatomy (user directive, 2026-08-26: "make it like a
     record kinda table") — the theme's one DataTable, right-click menu and
     all, instead of a column of cards */
  const columns: Column<HitRow>[] = [
    {
      key: "record",
      header: t("colRecord"),
      className: "font-medium text-fg",
      headClassName: "text-start",
      cell: (hit) => hit.call_title,
    },
    {
      key: "where",
      header: t("colWhere"),
      headClassName: "text-start",
      cell: (hit) => (
        <Chip tone={hit.kind === "transcript" ? "neutral" : "accent"}>
          {hit.kind === "summary"
            ? t("inSummary")
            : hit.kind === "call"
              ? t("inTitle")
              : t("inTranscript")}
        </Chip>
      ),
    },
    {
      key: "match",
      header: t("colMatch"),
      headClassName: "text-start",
      /* min-w-max sizes cells to content — a 30-word snippet must wrap in
         its own box, not stretch the table past every viewport */
      cell: (hit) => (
        <div className="max-w-xl whitespace-normal">
          <Snippet text={hit.snippet} />
        </div>
      ),
    },
    {
      key: "moment",
      header: t("colMoment"),
      headClassName: "text-start",
      className: "text-fg-muted",
      /* a summary hit HAS no moment — "—", never an invented 0:00 */
      cell: (hit) =>
        hit.start_ms !== null ? (
          <span className="ltr text-xs">{formatClock(hit.start_ms / 1000, locale)}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "date",
      header: t("colDate"),
      headClassName: "text-start",
      className: "text-fg-muted",
      /* a server one deploy behind sends no call_date — "—", never an
         Invalid Date wearing a date's clothes */
      cell: (hit) => (hit.call_date ? formatDate(hit.call_date, locale) : "—"),
    },
  ];

  return (
    /*
     * NO SECTION MENU. Search wore Echo's, back when Echo's menu had a search
     * row — and that row is gone: the top bar's field is the door on every
     * screen now, and a page that opened the menu it left would advertise a
     * row that no longer exists (user directive, 2026-09-02).
     */
    <PlatformShell>
        <PageContainer>
      <PageHeader title={t("title")} subtitle={t("scopeNote")} />

      {/* the CARD carries the focus affordance (focus-within border); the
          input opts out of the global ring — same ruling as the composer:
          no box inside a box while typing (user report) */}
      <Card className="mb-4 transition-colors focus-within:border-accent">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            className="input focus-visible:ring-0 focus-visible:ring-offset-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("placeholder")}
            autoFocus
          />
          <button className="btn-primary px-5" disabled={busy || !query.trim()}>
            {t("run")}
          </button>
        </form>
      </Card>

      {hits !== null && hits.length === 0 ? (
        <Card>
          <EmptyState text={t("empty")} />
        </Card>
      ) : (
        <>
          {/* the count waits for the answer; a "0 results" line above a table
              that is still loading is a claim nobody has checked */}
          {hits !== null ? (
            <p className="mb-2 text-sm text-fg-muted">
              {t("results", { count: digits(hits.length, locale) })}
            </p>
          ) : null}
          {/* NO FRAME (audit finding, 2026-09-02): the table renders bare,
              like members, invitations and Audit Logs. DataTable's rows are
              cards of their own — each one bg-surface with its own border
              and a 16px corner — so a bg-surface box around them draws an
              edge around a set of edges, and this hand-drawn rounded-lg was
              the last one of its kind on a list screen. If the records
              anatomy above ever wants its frame back, it is RecordsSection's
              own `<Card className="!p-0">`, never a hand-drawn border. */}
          <DataTable
            loading={hits === null}
            rows={rows}
            rowKey={(hit) => hit.rowId}
            columns={columns}
            onRowClick={(hit) => router.push(`/calls/${hit.call_id}`)}
            menuItems={(hit) => [
              {
                key: "open",
                label: t("openRecord"),
                icon: <IconOpen width={16} height={16} />,
                onSelect: () => router.push(`/calls/${hit.call_id}`),
              },
              {
                key: "copy",
                label: t("copyText"),
                icon: <IconCopy width={16} height={16} />,
                onSelect: () => {
                  void navigator.clipboard
                    .writeText(hit.snippet.replace(/<\/?mark>/g, ""))
                    .then(() => notify(t("copied")));
                },
              },
            ]}
          />
        </>
      )}
        </PageContainer>
    </PlatformShell>
  );
}
