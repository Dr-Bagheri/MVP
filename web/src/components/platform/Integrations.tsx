"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorProvider, ConnectorStatus, Me } from "@/api/types";
import { AssistantMenu } from "./AssistantMenu";
import { PlatformShell } from "./PlatformShell";
import { MenuLayout, PageContainer, PageHeader, Section } from "@/components/scaffold";
import { DataTable, StatusDot, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { personName } from "@/lib/format";

/**
 * The data sources this product reads — what is connected, and what could be
 * (user directive, 2026-08-28: integrations get a page of their own, under
 * Workflows, the way Sana arranges them).
 *
 * It also becomes the ONE door to connecting an account. The strip that used
 * to sit on `/workflows` moved here whole: the question it answered ("how do I
 * connect the email and calendar, where do I do it") deserves an address a
 * person can be sent to, rather than a row above a list of templates.
 *
 * **The available list is four things and there is no fifth.** Not Slack, not
 * Notion, not Drive — the product speaks to Google and Microsoft, for mail and
 * for calendars, and that is the whole surface. A tile for something we do not
 * integrate with is a claim we would then have to keep, and the person who
 * clicks it learns that the page lies before they learn anything else.
 */

/** The catalogue: every integration the platform ACTUALLY has, once each. */
const CATALOGUE = [
  { key: "gmail", provider: "google", icon: "mail", kind: "mail" },
  { key: "googleCalendar", provider: "google", icon: "calendar", kind: "calendar" },
  { key: "outlookMail", provider: "microsoft", icon: "mail", kind: "mail" },
  { key: "outlookCalendar", provider: "microsoft", icon: "calendar", kind: "calendar" },
] as const satisfies readonly {
  key: string;
  provider: ConnectorProvider;
  icon: IconName;
  kind: "mail" | "calendar";
}[];

export function Integrations() {
  const t = useTranslations("integrations");
  /* connect / reconnect / not-configured / enable-drafts already have ONE
     spelling apiece in the workflows catalogue, and they are the same
     sentences here — a second copy is a second thing to keep in step, and the
     one that drifts is always the copy nobody is looking at */
  const tw = useTranslations("workflows");
  const tp = useTranslations("platform");
  const locale = useLocale() as "fa" | "en";

  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.connectors().then(setConnectors).catch(() => setConnectors([]));
    void api.me().then(setMe).catch(() => setMe(null));
  }, []);

  async function connect(provider: ConnectorProvider) {
    setError(null);
    try {
      window.location.assign(await api.connectorAuthorization(provider, locale));
    } catch {
      setError(tw("connectFailed"));
    }
  }

  /*
   * Names resolved as LITERAL keys, here, rather than built from the entry's
   * own `key` field. The catalogue parity check only sees literal `t("…")`
   * calls by design, so a computed key is a key nothing guards — and a missing
   * one renders its own dotted path on screen, in the locale nobody is
   * reading. Same reason the detail page resolves its integration labels this
   * way rather than looping.
   */
  const COPY: Record<string, { name: string; description: string }> = {
    gmail: { name: t("gmail"), description: t("gmailDesc") },
    googleCalendar: { name: t("googleCalendar"), description: t("googleCalendarDesc") },
    outlookMail: { name: t("outlookMail"), description: t("outlookMailDesc") },
    outlookCalendar: { name: t("outlookCalendar"), description: t("outlookCalendarDesc") },
  };
  const providerName = (provider: ConnectorProvider) =>
    provider === "google" ? tw("google") : tw("microsoft");

  /*
   * A row per provider the person has actually CONNECTED — including the ones
   * whose grant has since expired or been revoked.
   *
   * Hiding those would be the wrong kind of nothing: a revoked Google
   * connection is not the same fact as never having connected Google, and a
   * table that showed only the healthy ones would say the second while the
   * first is true. It is also what makes the status column a column — a
   * column that can only ever say one word is not reporting anything.
   */
  const rows = (connectors ?? []).filter((entry) => entry.status !== "not_configured"
    && entry.status !== "not_connected");

  const columns: Column<ConnectorStatus>[] = [
    {
      key: "name",
      header: t("colName"),
      cell: (row) => (
        <span className="flex items-center gap-3">
          {/* the provider's initial in a tile — the platform ships no remote
              brand assets (CSP), and the same pattern already names the
              creator on the workflow detail page */}
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
            aria-hidden
          >
            {providerName(row.provider).slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">
              {providerName(row.provider)}
            </span>
            {row.account_label ? (
              <span dir="ltr" className="block truncate text-xs text-fg-muted">
                {row.account_label}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("colStatus"),
      cell: (row) =>
        row.status === "connected" ? (
          <StatusDot label={t("statusConnected")} />
        ) : row.status === "expired" ? (
          <StatusDot label={t("statusExpired")} tone="warning" />
        ) : (
          <StatusDot label={t("statusRevoked")} tone="danger" />
        ),
    },
    {
      key: "access",
      header: t("colAccess"),
      /* Always private, and that is a PRODUCT FACT rather than a column
         waiting to be filled in: every connection here is made by one person
         through their own OAuth consent and is readable only by them, so
         there is no org-shared variant for this cell to report. */
      cell: () => <span className="text-sm text-fg-muted">{t("accessPrivate")}</span>,
    },
    {
      key: "addedBy",
      header: t("colAddedBy"),
      /* the signed-in person, for the same reason: a connection belongs to
         whoever consented, and this list is only ever their own. `null` is a
         real state (no identity yet) and renders as a dash, never as a name */
      cell: () => (
        <span className="text-sm text-fg-muted">{personName(me, locale) || "—"}</span>
      ),
    },
  ];

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="integrations" />}>
        <PageContainer>
          <PageHeader title={tp("integrations")} subtitle={t("subtitle")} />

          <Section title={t("connectedTitle")} description={t("connectedHint")}>
            {connectors === null ? null : rows.length === 0 ? (
              <EmptyState text={t("noneConnected")} />
            ) : (
              <DataTable rows={rows} columns={columns} rowKey={(row) => row.provider} />
            )}
          </Section>

          <Section title={t("availableTitle")} description={t("availableHint")} divided>
            <div className="grid gap-4 sm:grid-cols-2">
              {CATALOGUE.map((entry) => {
                const state = connectors?.find((row) => row.provider === entry.provider);
                const copy = COPY[entry.key]!;
                return (
                  <div key={entry.key} className="card flex flex-col">
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted"
                        aria-hidden
                      >
                        <Icon name={entry.icon} size="lg" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-fg">
                          {copy.name}
                        </span>
                        <span className="block truncate text-xs text-fg-muted">
                          {providerName(entry.provider)}
                        </span>
                      </span>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-fg-muted">
                      {copy.description}
                    </p>
                    <div className="mt-4">
                      {connectors === null ? null : (
                        <IntegrationAction
                          state={state}
                          /* drafting scope only matters where drafts happen;
                             offering it on a calendar tile would explain
                             nothing about what the button is for */
                          mail={entry.kind === "mail"}
                          labels={{
                            connect: tw("connect", { provider: providerName(entry.provider) }),
                            reconnect: tw("reconnect", { provider: providerName(entry.provider) }),
                            notConfigured: tw("notConfigured", {
                              provider: providerName(entry.provider),
                            }),
                            enableDrafts: tw("enableDrafts"),
                            connected: t("connected"),
                          }}
                          onConnect={() => void connect(entry.provider)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {error ? <p role="status" className="mt-4 text-sm text-danger">{error}</p> : null}
          </Section>
        </PageContainer>
      </MenuLayout>
    </PlatformShell>
  );
}

/**
 * What a tile OFFERS, given what the server says about its provider.
 *
 * `not_configured` is a claim about the PRODUCT — the operator holds no OAuth
 * credentials for this provider — so it renders as a sentence and never as a
 * button, because a button here could not work for any person on any account.
 * The other four states are claims about this person's connection, and each
 * has an action that genuinely does something.
 */
function IntegrationAction({
  state,
  mail,
  labels,
  onConnect,
}: {
  state: ConnectorStatus | undefined;
  mail: boolean;
  labels: {
    connect: string;
    reconnect: string;
    notConfigured: string;
    enableDrafts: string;
    connected: string;
  };
  onConnect: () => void;
}) {
  if (state === undefined || !state.configured) {
    return (
      <span className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-fg-subtle">
        {labels.notConfigured}
      </span>
    );
  }
  if (state.status === "connected") {
    /* connected is not the same fact as can-draft: a connection made before
       drafting existed reads mail perfectly and fails at the provider on a
       draft, so the upgrade is OFFERED rather than discovered */
    return mail && state.can_draft === false ? (
      <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={onConnect}>
        {labels.enableDrafts}
      </button>
    ) : (
      <StatusDot label={labels.connected} />
    );
  }
  return (
    <button type="button" className="btn-secondary h-9 min-h-0 px-3 text-xs" onClick={onConnect}>
      {state.status === "not_connected" ? labels.connect : labels.reconnect}
    </button>
  );
}
