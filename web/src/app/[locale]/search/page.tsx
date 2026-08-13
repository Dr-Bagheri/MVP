"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { SearchHit } from "@/api/types";
import { EchoAppShell } from "@/components/echo/EchoAppShell";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { formatClock, digits } from "@/lib/format";

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

export default function SearchPage() {
  const t = useTranslations("search");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setHits(await api.search(query));
    setBusy(false);
  }

  return (
    <EchoAppShell page={t("title")}>
      <PageHeader title={t("title")} subtitle={t("scopeNote")} />

      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            className="input"
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

      {hits === null ? null : hits.length === 0 ? (
        <Card>
          <EmptyState text={t("empty")} />
        </Card>
      ) : (
        <>
          <p className="mb-2 text-sm text-fg-muted">
            {t("results", { count: digits(hits.length, locale) })}
          </p>
          <div className="space-y-2">
            {hits.map((hit, i) => (
              <Card key={i}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/calls/${hit.call_id}`}
                    className="text-sm font-medium text-fg hover:text-accent"
                  >
                    {hit.call_title}
                  </Link>
                  <Chip tone={hit.kind === "summary" ? "accent" : "neutral"}>
                    {hit.kind === "summary" ? t("inSummary") : t("inTranscript")}
                  </Chip>
                  {hit.start_ms !== null ? (
                    <span className="text-xs text-fg-muted ltr">
                      {formatClock(hit.start_ms / 1000, locale)}
                    </span>
                  ) : null}
                </div>
                <Snippet text={hit.snippet} />
              </Card>
            ))}
          </div>
        </>
      )}
    </EchoAppShell>
  );
}
