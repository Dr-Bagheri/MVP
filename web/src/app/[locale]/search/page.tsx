"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { api } from "@/api/client";
import type { SearchHit } from "@/api/types";
import { AppShell } from "@/components/AppShell";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { formatClock, digits } from "@/lib/format";

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
    <AppShell page={t("title")}>
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
                  <Chip tone={hit.source === "summary" ? "accent" : "neutral"}>
                    {hit.source === "summary" ? t("inSummary") : t("inTranscript")}
                  </Chip>
                  {hit.start_ms !== null ? (
                    <span className="text-xs text-fg-muted ltr">
                      {formatClock(hit.start_ms / 1000, locale)}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-7 text-fg-muted">{hit.snippet}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
