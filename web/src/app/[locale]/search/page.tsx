"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { api } from "@/api/client";
import type { SearchHit } from "@/api/types";
import { DataTable, type Column } from "@/components/DataTable";
import { EchoSectionMenu } from "@/components/echo/EchoSectionMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout, PageContainer, PageHeader } from "@/components/scaffold";
import { Card, Chip, EmptyState } from "@/components/ui";
import { IconCopy, IconOpen } from "@/components/icons";
import { digits, formatClock, formatDate } from "@/lib/format";
import { notify } from "@/lib/notify";

/**
 * Renders core/'s `<mark>` highlights WITHOUT innerHTML.
 *
 * Splitting on the tag pair is a whitelist BY CONSTRUCTION: only `<mark>`
 * can ever become an element, and every other piece is handed to React as a
 * string child, so anything else tag-shaped stays literal text and is
 * escaped. That matters because the snippet derives from transcript text,
 * which is untrusted input — the server's guarantee about what it emits is
 * not a reason to render it as HTML.
 *
 * Marks may be absent entirely: matching is Persian-folded server-side, but
 * folding deletes ZWNJ, so highlighting runs against the RAW text and a hit
 * that matched only via the fold comes back correct but unmarked. This has
 * to look right with zero marks, and it does — the whole snippet is then one
 * unmarked chunk. Never re-fold here to recover them: a second normalisation
 * rule would drift from the index it is meant to mirror.
 */
function Snippet({ text }: { text: string }) {
  // odd indices are the captured group — i.e. the marked runs
  const pieces = text.split(/<mark>([\s\S]*?)<\/mark>/g);
  return (
    <p className="text-sm leading-7 text-fg-muted">
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-accent/20 px-0.5 text-fg">
            {piece}
          </mark>
        ) : (
          piece
        ),
      )}
    </p>
  );
}

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
    /* search searches the RECORDS, so it wears Echo's menu (user directive,
       2026-08-25 — reversing 2026-08-18's assistant placement) */
    <PlatformShell>
      <MenuLayout menu={<EchoSectionMenu activeSlug="search" />}>
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
          <div className="rounded-lg border border-border bg-surface">
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
          </div>
        </>
      )}
        </PageContainer>
      </MenuLayout>
    </PlatformShell>
  );
}
