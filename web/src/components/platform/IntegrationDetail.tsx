"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorItem, ConnectorStatus, Me } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { PlatformShell } from "./PlatformShell";
import { useCrumbTitle } from "./CrumbTitle";
import { PageContainer } from "@/components/scaffold";
import { DataTable, StatusDot, type Column } from "@/components/DataTable";
import { Card, EmptyState } from "@/components/ui";
import { ConfirmDialog, KebabMenu } from "@/components/rowActions";
import { Icon, IconRetry, IconTrash } from "@/components/icons";
import { digits, formatRelativeDate, formatTime, personName } from "@/lib/format";
import { foldSearch, integrationBySlug, useIntegrationCopy } from "./integrationsCatalogue";

/**
 * ONE integration: what it reads, and where it stands (user directive,
 * 2026-08-28, from the Sana screenshots: "if it already connected the data
 * table and the details with setting kebab menu that you can disconnect").
 *
 * The page is Sana's anatomy in this theme: identity header, the ASSETS
 * table (the source's items, from the wire), a details panel, and a gear
 * menu holding refresh + disconnect. The way back is the breadcrumb —
 * `/integrations/[slug]`'s parent crumb IS "< All integrations", in the
 * platform's one back mechanism rather than a page-local link beside it.
 *
 * ── What this page refuses to invent ────────────────────────────────────────
 *
 * **"Connection created"** — Sana shows it; our wire does not carry the
 * grant's creation time, so the row is OMITTED rather than dressed with
 * `expires_at` or the poll time wearing its costume. A detail panel earns
 * trust by every row being checkable.
 *
 * **Per-item status** — the wire lists items, it does not grade them. A row
 * that is on the list was just read from the provider, and that is the one
 * claim the Status column makes («در دسترس»), the same word on every row it
 * can truthfully say it about.
 *
 * **"Last synced"** — only the mailbox is polled, so only mail gets the row;
 * calendar/Meet/Drive are read on demand and a sync time for them would be
 * an invention. Same for the assets COUNT versus the mailbox's cumulative
 * messages-seen: two different numbers, two labelled rows, never merged.
 */
export function IntegrationDetail({ slug }: { slug: string }) {
  const entry = integrationBySlug(slug);
  const t = useTranslations("integrations");
  /* the connect/reconnect/not-configured sentences keep their ONE spelling
     in the workflows catalogue — same reason as the overview page */
  const tw = useTranslations("workflows");
  const locale = useLocale() as "fa" | "en";
  const router = useRouter();
  const copy = useIntegrationCopy();

  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  /** undefined = loading · null = the fetch failed · [] = genuinely empty —
      three different nothings, three different sentences */
  const [items, setItems] = useState<ConnectorItem[] | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  /** bumping this re-runs the items fetch — the gear's "refresh the list" */
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = entry ? copy[entry.key].name : null;
  /* while the catalogue KNOWS the slug the title is known synchronously;
     an unknown slug renders the untitled word rather than a broken crumb */
  useCrumbTitle(name);

  useEffect(() => {
    void api.connectors().then(setConnectors).catch(() => setConnectors([]));
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const state = entry ? connectors?.find((row) => row.provider === entry.provider) : undefined;
  /*
   * "Live" = the assets listing can actually be served: the grant stands AND
   * covers this source. Drive on a pre-Drive grant is connected-but-not-live
   * — a reconnect offer, never an error (the grant predates the scope; see
   * core's can_drive derivation).
   */
  const live = entry !== undefined && state !== undefined && state.status === "connected"
    && (entry.source !== "drive" || state.can_drive);

  useEffect(() => {
    if (!entry || !live) return;
    let stale = false;
    setItems(undefined);
    /* the fetch names the SOURCE from the catalogue entry — mail, calendar,
       drive or meet — which is exactly what the row click promised */
    api.connectorItems(entry.provider, entry.source)
      .then((rows) => { if (!stale) setItems(rows); })
      .catch(() => { if (!stale) setItems(null); });
    return () => { stale = true; };
  }, [entry, live, tick]);

  async function connect() {
    if (!entry) return;
    setError(null);
    try {
      window.location.assign(await api.connectorAuthorization(entry.provider, locale));
    } catch {
      setError(tw("connectFailed"));
    }
  }

  /*
   * Search filters CLIENT-SIDE over the loaded page (the wire serves the 20
   * most recent items, no server-side query parameter exists) — honest for a
   * list this size, and said here so nobody mistakes it for a provider
   * search. Folded for ZWNJ like every search on this surface.
   */
  const needle = foldSearch(query.trim());
  const visible = (items ?? []).filter((item) =>
    needle === ""
    || foldSearch(item.title).includes(needle)
    || foldSearch(item.subtitle).includes(needle));

  const when = (iso: string | null): string => {
    if (!iso) return "—";
    /* Gmail's occurred_at is an RFC-2822 header written by an arbitrary mail
       client — unparseable must render as unknown, never as a 1970 date */
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return "—";
    const normalized = at.toISOString();
    return `${formatRelativeDate(normalized, locale)} ${formatTime(normalized, locale)}`;
  };

  const columns: Column<ConnectorItem>[] = [
    {
      key: "title",
      header: t("colName"),
      cell: (item) => (
        <span className="block min-w-0">
          {/* provider titles arrive in either script — let the text decide */}
          <span dir="auto" className="block max-w-[38ch] truncate text-sm font-medium text-fg">
            {item.title}
          </span>
          {item.subtitle ? (
            <span dir="auto" className="block max-w-[38ch] truncate text-xs text-fg-muted">
              {item.subtitle}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: t("colAssetStatus"),
      /* one truthful claim per row: it was just read from the provider —
         the wire grades nothing finer, so neither do we */
      cell: () => <StatusDot label={t("assetAvailable")} />,
    },
    {
      key: "updated",
      header: t("colUpdated"),
      cell: (item) => <span className="text-sm text-fg-muted">{when(item.occurred_at)}</span>,
    },
  ];

  const providerLabel = entry
    ? (entry.provider === "google" ? tw("google") : tw("microsoft"))
    : "";

  return (
    <PlatformShell>
      <>
        {/* SMALL, like the overview it opens from (audit finding, 2026-09-02):
            this is a Settings sub-page — an identity row, one table, a details
            aside, the meeting-plan shape — and it opened at the list width, so
            clicking a row widened the page by 200px */}
        <PageContainer width="small">
          {entry === undefined ? (
            <Card><p className="text-sm text-fg-muted">{t("detailMissing")}</p></Card>
          ) : connectors === null ? null : (
            <>
              <header className="flex flex-wrap items-start gap-6">
                <span
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-surface-2 text-fg-muted"
                  aria-hidden
                >
                  <Icon name={entry.icon} size="hero" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold text-fg">{name}</h1>
                  <p className="mt-1 text-xs text-fg-muted">{providerLabel}</p>
                  <p className="mt-2 max-w-[70ch] text-sm leading-7 text-fg-muted">
                    {copy[entry.key].description}
                  </p>
                </div>
                {state?.status === "connected" ? (
                  /* the SETTINGS menu (the reference's gear): refresh is a
                     re-fetch of the listing and says so; disconnect asks
                     first, in the theme's one dialog, below */
                  <KebabMenu
                    label={t("settingsLabel")}
                    trigger={<Icon name="settings" size="md" />}
                    items={[
                      {
                        key: "refresh",
                        label: t("refreshList"),
                        icon: <IconRetry width={16} height={16} />,
                        disabled: !live,
                        onSelect: () => setTick((n) => n + 1),
                      },
                      {
                        key: "disconnect",
                        label: t("disconnect"),
                        icon: <IconTrash width={16} height={16} />,
                        danger: true,
                        onSelect: () => setAsking(true),
                      },
                    ]}
                  />
                ) : null}
              </header>

              <div className="mt-8">
                {state === undefined || !state.configured ? (
                  /* a claim about the PRODUCT, so a sentence and no button */
                  <Card>
                    <p className="text-sm text-fg-muted">
                      {tw("notConfigured", { provider: providerLabel })}
                    </p>
                  </Card>
                ) : state.status === "not_connected" ? (
                  <EmptyState
                    text={t("notConnectedYet")}
                    action={
                      <button type="button" className="btn-primary h-10 min-h-0 px-4 text-sm" onClick={() => void connect()}>
                        {tw("connect", { provider: providerLabel })}
                      </button>
                    }
                  />
                ) : state.status !== "connected" ? (
                  /* expired / revoked: the fact, then the door back in */
                  <Card className="flex flex-wrap items-center justify-between gap-4">
                    <StatusDot
                      label={state.status === "expired" ? t("statusExpired") : t("statusRevoked")}
                      tone={state.status === "expired" ? "warning" : "danger"}
                    />
                    <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={() => void connect()}>
                      {tw("reconnect", { provider: providerLabel })}
                    </button>
                  </Card>
                ) : !live ? (
                  /* Drive on a grant that predates the scope: connected, and
                     the listing is one re-consent away — an OFFER, not an
                     error (nothing here is broken) */
                  <Card>
                    <p className="text-sm font-medium text-fg">{t("reconnectDrive")}</p>
                    <p className="mt-1 max-w-[70ch] text-sm leading-6 text-fg-muted">
                      {t("reconnectDriveHint")}
                    </p>
                    <button
                      type="button"
                      className="btn-secondary mt-4 h-9 min-h-0 px-3 text-xs"
                      onClick={() => void connect()}
                    >
                      {tw("reconnect", { provider: providerLabel })}
                    </button>
                  </Card>
                ) : (
                  <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
                    <section className="rounded-xl border border-border bg-surface p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-fg">{t("assetsTitle")}</h2>
                        <label className="min-w-0 sm:w-64">
                          <span className="sr-only">{t("searchAssets")}</span>
                          <input
                            type="search"
                            className="input h-9 min-h-0 py-0 text-sm"
                            placeholder={t("searchAssets")}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="mt-4">
                        {items === undefined ? null : items === null ? (
                          <p role="status" className="py-8 text-center text-sm text-danger">
                            {t("assetsFailed")}
                          </p>
                        ) : (
                          /* ten rows then pages — the table rule (M42) rides
                             in with DataTable's default page size */
                          <DataTable
                            rows={visible}
                            columns={columns}
                            rowKey={(item) => item.id}
                            empty={
                              <EmptyState
                                text={items.length === 0 ? t("noAssets") : t("noAssetsMatch")}
                              />
                            }
                          />
                        )}
                      </div>
                    </section>

                    <aside className="rounded-xl border border-border bg-surface p-6">
                      <h2 className="text-lg font-semibold text-fg">{t("detailsTitle")}</h2>
                      <dl className="mt-4 space-y-4">
                        <Row label={t("connectedBy")}>
                          <span className="block">{personName(me, locale) || "—"}</span>
                          {state.account_label ? (
                            <span dir="ltr" className="block truncate text-xs text-fg-muted">
                              {state.account_label}
                            </span>
                          ) : null}
                        </Row>
                        {/* "Connection created": not on the wire — omitted
                            rather than faked with expires_at or the poll
                            time wearing its costume */}
                        {entry.source === "mail" ? (
                          <>
                            <Row label={t("lastSynced")}>
                              {state.polled_at
                                ? `${formatRelativeDate(state.polled_at, locale)} ${formatTime(state.polled_at, locale)}`
                                : "—"}
                            </Row>
                            <Row label={t("messagesProcessed")}>
                              {digits(state.messages_seen, locale)}
                            </Row>
                          </>
                        ) : null}
                        <Row label={t("colAssets")}>
                          {items ? digits(items.length, locale) : "—"}
                        </Row>
                        <Row label={t("colStatus")}>
                          <StatusDot
                            label={
                              entry.source === "mail" && state.polled_at !== null
                                ? t("statusSynced")
                                : t("statusActive")
                            }
                          />
                        </Row>
                        <Row label={t("colAccess")}>{t("accessJustYou")}</Row>
                      </dl>
                      {/* the privacy card, Sana's "Private integration" told
                          truthfully: per-person grant (D29), read on demand,
                          never in logs */}
                      <div className="mt-6 rounded-xl border border-border bg-surface-2/40 p-4">
                        <p className="text-sm font-medium text-fg">{t("privacyTitle")}</p>
                        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("privacyNote")}</p>
                      </div>
                    </aside>
                  </div>
                )}
              </div>
              {error ? <p role="status" className="mt-4 text-sm text-danger">{error}</p> : null}
            </>
          )}
        </PageContainer>
      </>

      {/*
        Destructive actions confirm — the platform's rule, one dialog,
        enforced by confirm.guard.test.ts. The body carries the two facts a
        person cannot see from the button: the grant is revoked at the
        provider (drafts stop), and every source of this account disconnects
        together, because four tiles share one sign-in.
      */}
      {asking && entry ? (
        <ConfirmDialog
          title={t("disconnectTitle", { name: name ?? "" })}
          body={t("disconnectBody")}
          confirmLabel={t("disconnectConfirm")}
          cancelLabel={t("cancel")}
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            setError(null);
            void api.disconnectConnector(entry.provider)
              .then(() => {
                setAsking(false);
                /* the connection is gone — the honest place to stand is the
                   overview, where the table now says so */
                router.push("/integrations");
              })
              .catch(() => setError(t("disconnectFailed")))
              .finally(() => setBusy(false));
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </PlatformShell>
  );
}

/** one labelled fact in the details panel */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-fg">{children}</dd>
    </div>
  );
}
