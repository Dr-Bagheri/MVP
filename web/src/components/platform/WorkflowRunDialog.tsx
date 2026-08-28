"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorItem, ConnectorProvider, ConnectorStatus, WorkflowCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { Pagination, usePaged } from "@/components/Pagination";
import { IconClose } from "@/components/icons";

/**
 * "Run this template on…" — the source picker, MOVED here from the workflows
 * list (2026-08-28, user directive: a workflow "should only be run from inside
 * their own page").
 *
 * It is the same flow, carried across rather than rewritten: the list used to
 * unfold it inside the card, which meant the page offered to start something
 * before it offered to explain it. Now the only door is the workflow's own
 * page, behind its ⋯ menu, where the process the run will follow is on screen
 * beside the button.
 *
 * Choosing an item IS the instruction, so there is no confirm step and no
 * confirm button — picking navigates. The way out is the ✕ and Escape.
 */
export function WorkflowRunDialog({
  slug,
  sourceKind,
  title,
  onClose,
}: {
  slug: string;
  sourceKind: WorkflowCard["source_kind"];
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations("workflows");
  const locale = useLocale() as "fa" | "en";
  const router = useRouter();

  const [connections, setConnections] = useState<ConnectorStatus[] | null>(null);
  const [provider, setProvider] = useState<ConnectorProvider | null>(null);
  const [items, setItems] = useState<Record<string, ConnectorItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceLabel = sourceKind === "calendar_event" ? t("calendarSource") : t("mailSource");
  const source = sourceKind === "calendar_event" ? "calendar" : "mail";
  const connected = (connections ?? []).filter((entry) => entry.status === "connected");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    void api.connectors().then(setConnections).catch(() => setConnections([]));
  }, []);

  /* the first connected account is the opening choice, but it is DISCLOSED
     as a chip rather than applied invisibly — an undisclosed default reads
     as "the options don't work" (user report, 2026-08-20) */
  useEffect(() => {
    if (provider === null && connected.length > 0) setProvider(connected[0]!.provider);
  }, [connected, provider]);

  useEffect(() => {
    if (provider === null || items[provider] !== undefined) return;
    let live = true;
    setLoading(true);
    setError(null);
    api.connectorItems(provider, source)
      .then((loaded) => {
        if (live) setItems((current) => ({ ...current, [provider]: loaded }));
      })
      .catch(() => {
        if (live) setError(t("sourceLoadFailed"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [provider, source, items, t]);

  async function connect(entry: ConnectorProvider) {
    setError(null);
    try {
      window.location.assign(await api.connectorAuthorization(entry, locale));
    } catch {
      setError(t("connectFailed"));
    }
  }

  const list = provider === null ? [] : items[provider] ?? [];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            aria-label={t("runClose")}
            title={t("runClose")}
            className="tap -me-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={onClose}
          >
            <IconClose width={14} height={14} />
          </button>
        </div>

        {connections === null ? null : connected.length === 0 ? (
          <div className="mt-3">
            <p className="text-sm leading-6 text-fg-muted">
              {t("connectRequired", { source: sourceLabel })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["google", "microsoft"] as const).map((entry) => {
                const state = connections.find((connection) => connection.provider === entry);
                /* `not_configured` is a claim about the PRODUCT (the operator
                   holds no OAuth credentials for this provider), so it renders
                   as a sentence and never as a button that cannot work */
                return state?.configured ? (
                  <button
                    key={entry}
                    type="button"
                    className="btn-secondary h-9 min-h-0 px-3 text-xs"
                    onClick={() => void connect(entry)}
                  >
                    {t("connect", { provider: t(entry) })}
                  </button>
                ) : (
                  <span
                    key={entry}
                    className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-fg-subtle"
                  >
                    {t("notConfigured", { provider: t(entry) })}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            {connected.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t("provider")}>
                {connected.map((connection) => (
                  <button
                    key={connection.provider}
                    type="button"
                    aria-pressed={provider === connection.provider}
                    className={`tap h-8 rounded-full border px-3 text-xs ${
                      provider === connection.provider
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-fg-muted hover:text-fg"
                    }`}
                    onClick={() => setProvider(connection.provider)}
                  >
                    {t(connection.provider)}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mb-2 text-xs font-medium text-fg-subtle">
              {t("chooseSource", { source: sourceLabel })}
            </p>
            {loading ? (
              <p className="text-sm text-fg-muted">{t("sourceLoading")}</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("sourceEmpty", { source: sourceLabel })}</p>
            ) : (
              <SourcePicker
                items={list}
                fallbackLabel={sourceLabel}
                /* `/assistant`, NOT `/`. The hub moved off `/` when the
                   dashboard took the landing page (2026-08-25) and this
                   launcher kept pushing at the old address: the route still
                   resolved, so every reachability check stayed green while
                   picking an email landed on a briefing screen that reads none
                   of these params and ran nothing. `run=1` starts it —
                   choosing the item IS the instruction. */
                onPick={(item) => router.push({
                  pathname: "/assistant",
                  query: {
                    workflow: slug,
                    connectorProvider: provider!,
                    sourceId: item.id,
                    run: "1",
                  },
                })}
              />
            )}
          </div>
        )}

        {error ? <p role="status" className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}

/**
 * The source list a workflow runs ON — ten per page like every other table.
 * Its own component because `usePaged` is a hook and the list only exists
 * once a provider has answered.
 */
function SourcePicker({
  items,
  fallbackLabel,
  onPick,
}: {
  items: ConnectorItem[];
  fallbackLabel: string;
  onPick: (item: ConnectorItem) => void;
}) {
  const { page, setPage, pageCount, visible } = usePaged(items);
  return (
    <>
      <ul className="space-y-1">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="tap flex w-full flex-col rounded-lg px-2 py-2 text-start hover:bg-surface-2"
              onClick={() => onPick(item)}
            >
              <span className="truncate text-sm font-medium text-fg">{item.title}</span>
              <span className="truncate text-xs text-fg-muted">
                {item.subtitle || item.occurred_at || fallbackLabel}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
    </>
  );
}
