"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Select } from "@/components/Select";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorProvider, ConnectorStatus, Me } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { PageContainer } from "@/components/scaffold";
import { DataTable, StatusDot, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/ui";
import { ConfirmDialog } from "@/components/rowActions";
import { Icon, type IconName } from "@/components/icons";
import { SectionTabs } from "./sectionTabs";
import { digits, formatRelativeDate, formatTime, personName } from "@/lib/format";
import {
  INTEGRATIONS,
  foldSearch,
  useIntegrationCopy,
  type IntegrationEntry,
} from "./integrationsCatalogue";

/**
 * The data sources this product reads — what is connected, and what could be
 * (user directive, 2026-08-28: integrations get a page of their own, under
 * Workflows, the way Sana arranges them; second round the same day: "the
 * items in table must be selectable … make the steps easier and more user
 * friendly").
 *
 * It also remains the ONE door to connecting an account, but the door grew a
 * hallway: pressing Connect now opens a small dialog that says what the
 * integration enables, that the connection is private to this person (D29),
 * and that one Google sign-in covers all four Google sources — and only THEN
 * hands off to the provider. The OAuth redirect is disorienting enough
 * without arriving there unbriefed.
 *
 * **The catalogue lives in `integrationsCatalogue.ts` now**, shared with the
 * detail page — two screens each holding their own list is how one learns
 * about Drive while the other keeps rendering three tiles.
 *
 * **The connected table lists SOURCES, not accounts** (user report,
 * 2026-08-28: "i got the email but it did not update itself … it must show
 * in that table"). One Google grant is four things the product does — mail,
 * calendar, Meet, Drive — and they do not share state: the mailbox is
 * polled, so it has a last-looked time and a count; the others are read on
 * demand and have neither. Each source row is SELECTABLE and opens that
 * integration's own page.
 */

/**
 * One line of the connected table: what the product reads, not what the
 * person signed into. A provider's grant fans out into one of these per
 * source.
 */
interface SourceRow {
  /** the detail page's address — the row click is a navigation */
  slug: string;
  provider: ConnectorProvider;
  icon: IconName;
  name: string;
  /** the account the grant was made on — the same label under every source */
  accountLabel: string | null;
  status: ConnectorStatus["status"];
  /** when the poller last looked; null on a mailbox it has never reached */
  polledAt: string | null;
  /** messages the poller has passed through; null where nothing is counted */
  messagesSeen: number | null;
}

/** What a tile offers, decided in ONE place so the card and its button agree. */
type TileAction =
  | { kind: "sentence" }
  | { kind: "connect" }
  | { kind: "reconnect" }
  | { kind: "enableDrafts" }
  | { kind: "reconnectDrive" }
  | { kind: "connected" };

function tileAction(entry: IntegrationEntry, state: ConnectorStatus | undefined): TileAction {
  if (state === undefined || !state.configured) return { kind: "sentence" };
  if (state.status === "connected") {
    /* connected is not the same fact as can-drive: a grant made before Drive
       joined the sign-in reads mail perfectly and cannot list a single file,
       so the upgrade is OFFERED rather than discovered as an error */
    if (entry.source === "drive" && state.can_drive === false) return { kind: "reconnectDrive" };
    /* same shape for drafting: a pre-drafting grant reads mail and fails at
       the provider on a draft */
    if (entry.source === "mail" && state.can_draft === false) return { kind: "enableDrafts" };
    return { kind: "connected" };
  }
  return state.status === "not_connected" ? { kind: "connect" } : { kind: "reconnect" };
}

export function Integrations() {
  const t = useTranslations("integrations");
  /* connect / reconnect / not-configured / enable-drafts already have ONE
     spelling apiece in the workflows catalogue, and they are the same
     sentences here — a second copy is a second thing to keep in step, and the
     one that drifts is always the copy nobody is looking at */
  const tw = useTranslations("workflows");
  const locale = useLocale() as "fa" | "en";
  const router = useRouter();
  const copy = useIntegrationCopy();

  /* which half of the page is showing. `available` first: on a fresh account
     there is nothing connected, and a person who arrives at an empty table
     has to work out that the offer is further down. */
  const [tab, setTab] = useState<"available" | "connected">("available");
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** "" = every app; otherwise the one provider whose rows are shown */
  const [app, setApp] = useState<ConnectorProvider | "">("");
  /** the connect briefing dialog, per tile; null = closed */
  const [briefing, setBriefing] = useState<{ entry: IntegrationEntry; reconnect: boolean } | null>(null);

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

  const providerName = (provider: ConnectorProvider) =>
    provider === "google" ? tw("google") : tw("microsoft");

  /*
   * A row per SOURCE of every provider the person has actually CONNECTED —
   * including the ones whose grant has since expired or been revoked.
   *
   * Hiding those would be the wrong kind of nothing: a revoked Google
   * connection is not the same fact as never having connected Google, and a
   * table that showed only the healthy ones would say the second while the
   * first is true. It is also what makes the status column a column — a
   * column that can only ever say one word is not reporting anything.
   *
   * The one deliberate exception is Drive on a grant that never included it
   * (`can_drive: false`): there is no Drive connection to report on — not a
   * broken one, an unasked one — so Drive stays on its Available card with
   * the reconnect offer instead of sitting here wearing a status it never
   * had.
   *
   * The order is the catalogue's, so a provider's sources sit together.
   */
  const allRows: SourceRow[] = INTEGRATIONS.flatMap((entry) => {
    const state = (connectors ?? []).find((row) => row.provider === entry.provider);
    if (!state || state.status === "not_configured" || state.status === "not_connected") {
      return [];
    }
    if (entry.source === "drive" && state.can_drive === false) return [];
    const mail = entry.source === "mail";
    return [{
      slug: entry.slug,
      provider: entry.provider,
      icon: entry.icon,
      name: copy[entry.key].name,
      accountLabel: state.account_label,
      status: state.status,
      /* only the mailbox is polled — the other sources are read on demand,
         so they have no poll to report and no count to give; null here is
         "nothing counts this", not "zero" */
      polledAt: mail ? state.polled_at : null,
      messagesSeen: mail ? state.messages_seen : null,
    }];
  });

  /** the apps with a row — a filter offering one option filters nothing */
  const apps = [...new Set(allRows.map((row) => row.provider))];
  const needle = foldSearch(query.trim());
  const rows = allRows.filter((row) =>
    (app === "" || row.provider === app)
    /* the account label is matched too: it is the other text on the row, and
       a search that ignores what a person can plainly read is a search that
       lies about its own result */
    && (needle === ""
      || foldSearch(row.name).includes(needle)
      || foldSearch(row.accountLabel ?? "").includes(needle)));

  const columns: Column<SourceRow>[] = [
    {
      key: "name",
      header: t("colName"),
      cell: (row) => (
        <span className="flex items-center gap-3">
          {/* the SOURCE's mark, not the provider's: two rows of one grant
              differ by what they read. No remote brand assets (CSP) */}
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted"
            aria-hidden
          >
            <Icon name={row.icon} size="md" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{row.name}</span>
            {row.accountLabel ? (
              <span dir="ltr" className="block truncate text-xs text-fg-muted">
                {row.accountLabel}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("colStatus"),
      /*
       * ACTIVE and SYNCED are two different claims and the table makes them
       * two different words. Active says the grant is good; Synced says the
       * poller reached this mailbox, and when — which is the question the
       * person asked ("i got the email but it did not update itself"). A
       * mailbox the poller has never looked at is Active, never Synced with
       * an invented time.
       */
      cell: (row) =>
        row.status !== "connected" ? (
          row.status === "expired" ? (
            <StatusDot label={t("statusExpired")} tone="warning" />
          ) : (
            <StatusDot label={t("statusRevoked")} tone="danger" />
          )
        ) : row.polledAt === null ? (
          <StatusDot label={t("statusActive")} />
        ) : (
          <span className="block">
            <StatusDot label={t("statusSynced")} />
            <span className="mt-0.5 block text-xs text-fg-subtle">
              {`${formatRelativeDate(row.polledAt, locale)} ${formatTime(row.polledAt, locale)}`}
            </span>
          </span>
        ),
    },
    {
      key: "assets",
      header: t("colAssets"),
      /*
       * A real zero is a zero. `messagesSeen === 0` means the poller looked
       * and found nothing yet, and rendering that as a dash would report a
       * working connection as unmeasured — the dash belongs to the rows
       * where nothing is counted at all.
       */
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {row.messagesSeen === null ? "—" : digits(row.messagesSeen, locale)}
        </span>
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
    /*
     * THE SUB-MENU IS THE PAGE'S OWN NOW (user directive, 2026-09-04: "in the
     * integration page make a sub menu on top with two sub sections, first
     * Available integrations and second Connected integrations").
     *
     * Which is a different thing from the one removed on 2026-09-03, and the
     * difference is the whole reason both directives are right. That one was
     * the SETTINGS menu — eight sections belonging to a surface this page had
     * left — showing above a screen that is not one of them. This one names
     * the two halves of this page. A menu about where you are beats a menu
     * about where you used to live.
     *
     * The two halves used to be stacked, so a person with four connections
     * scrolled past their own table to reach the offer, or past the offer to
     * reach their table, depending which mattered that day. Neither ordering
     * is right for both, which is what a tab is for.
     *
     * NOT routes: `?tab=` would make two addresses for one screen and put a
     * filter in the browser history, so the back button would undo a tab
     * rather than leaving the page. The rail is the way out.
     *
     * It wore `SettingsPane` from 2026-09-02, when Integrations lived in the
     * Settings menu and needed a way back to its siblings. It is a RAIL
     * destination again since this morning — it sits beside Agents — so the
     * toolbar was showing a menu the page no longer belongs to: eight
     * Settings sections above a screen that is not one of them.
     *
     * A page reached from the rail has the rail as its way back.
     *
     * The shell itself is mounted by the ROUTE (app/[locale]/integrations),
     * exactly as meetings and tasks do it. The first attempt dropped
     * `SettingsPane` and nothing else — which took `TwoPane` with it, and
     * TwoPane is what renders `PlatformShell`, so the page lost the rail and
     * the top bar along with the menu it was meant to lose. Removing a
     * wrapper removes everything the wrapper was doing, not just the part
     * that was in the way.
     */
    <PageContainer>
          <SectionTabs
            label={t("sectionsLabel")}
            active={tab}
            onSelect={setTab}
            className="mb-5"
            tabs={[
              { key: "available", label: t("availableTitle") },
              /* the count is the reason to look: "3" answers "is anything
                 connected" without opening the tab, and an absent number
                 (still loading) is left absent rather than shown as 0 */
              { key: "connected", label: t("connectedTitle"),
                count: connectors === null ? undefined : allRows.length },
            ]}
          />

          {/* TAB PANELS ARE PLAIN BOXES, not Sections (user, 2026-09-05: "the
              gap between the sub menu and the buttons is too much"). `Section`
              pads its top by a rhythm step except for the FIRST section, and
              with the connected panel first in the DOM the available panel —
              the default tab — was the second: the default view opened 48px
              under its tabs while the other tab opened at 16. A tab panel has
              no title and no divider; it needs nothing Section gives, and the
              tabs carry the template's own `mb-5` (tasks, meetings, workflows). */}
          <div hidden={tab !== "connected"}>
            {connectors !== null && allRows.length === 0 ? (
              <EmptyState text={t("noneConnected")} />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <label className="min-w-0 flex-1 sm:max-w-xs">
                    <span className="sr-only">{t("searchPlaceholder")}</span>
                    <input
                      type="search"
                      /* audit finding, 2026-09-02: `h-10 min-h-0 py-0 text-sm`
                         re-answered the one question `.input` exists to answer
                         — and pinned 40px at EVERY width, discarding the 44px
                         hit-area floor the class carries below md. The Audit
                         Logs filter was stripped of the same four for the
                         same reason; the class owns height and type here too. */
                      className="input"
                      placeholder={t("searchPlaceholder")}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  {/*
                    Sana's row of chips is three; ours is one, because two of
                    theirs cannot be true here. There is no owner to filter by
                    — every connection on this page is the signed-in person's
                    own OAuth consent — and a second app filter spelled "All"
                    would be the same control twice. A chip that narrows
                    nothing is a control that does nothing, which this repo
                    treats as a defect rather than as decoration.
                  */}
                  {apps.length > 1 ? (
                    <label>
                      <span className="sr-only">{t("filterApps")}</span>
                      <Select
                        className="w-auto"
                        value={app}
                        placeholder={t("filterAllApps")}
                        onChange={(next) => setApp(next as ConnectorProvider | "")}
                        options={[
                          { value: "", label: t("filterAllApps") },
                          ...apps.map((provider) => ({
                            value: provider, label: providerName(provider),
                          })),
                        ]}
                      />
                    </label>
                  ) : null}
                </div>
                {/* "nothing matched" is not "nothing connected", and the two
                    empty states say so in different sentences */}
                <DataTable
                  loading={connectors === null}
                  rows={rows}
                  columns={columns}
                  rowKey={(row) => row.slug}
                  /* the row IS the way in (user directive: "the items in
                     table must be selectable") — it opens that integration's
                     own page, assets and settings included */
                  onRowClick={(row) => router.push(`/integrations/${row.slug}`)}
                  empty={<EmptyState text={t("noneMatch")} />}
                />
              </>
            )}
          </div>

          <div hidden={tab !== "available"}>
            {/* audit finding, 2026-09-02: the same step down as the block
                above — two headings on one screen must not answer the
                "how big is a block title" question twice */}
            {/* one row of four from xl up (the offer IS four Google sources) —
                compact, Sana-shaped (user directive, 2026-08-28) */}
            {/* TWO PER ROW, not four (user directive, 2026-09-02: "change the
                style of the integration to a small page as well, make the big
                buttons smaller so it fits"): the section is the small column
                now, and four 44-high cards across 1040px were each too narrow
                for their own sentence */}
            <div className="grid gap-3 sm:grid-cols-2">
              {INTEGRATIONS.map((entry) => {
                const state = connectors?.find((row) => row.provider === entry.provider);
                const action = connectors === null ? null : tileAction(entry, state);
                /* what a CLICK on the card does — decided from the same
                   action the button renders, so the two can never disagree:
                   a connected tile opens its detail page, an unconnected one
                   opens the connect briefing, an unconfigured one is not a
                   control at all */
                const open =
                  action === null || action.kind === "sentence"
                    ? null
                    : action.kind === "connect" || action.kind === "reconnect"
                      ? () => setBriefing({ entry, reconnect: action.kind === "reconnect" })
                      : () => router.push(`/integrations/${entry.slug}`);
                return (
                  <div
                    key={entry.slug}
                    /* the WORKFLOW card's FAMILY — same corner, same border,
                       same glowing round tile recipe — at COMPACT scale
                       (user directive, 2026-08-28, second round: all four in
                       one row, closer together, per the Sana reference). The
                       first round's "look like the workflow big buttons"
                       verbatim copy is deliberately superseded: kinship now
                       lives in the recipe, not the measurements.
                       audit finding, 2026-09-02: the recipe is `.card` — this
                       spelled out its corner, border, ground and padding by
                       hand and left out the one part that is not a
                       measurement, the ambient shadow, so four cards sat flat
                       under shadowed table rows. Wearing the class means the
                       next change to what a card is reaches these too. */
                    className={`card group flex flex-col ${open ? "cursor-pointer transition-colors hover:border-border-strong hover:bg-surface-2" : ""}`}
                    {...(open
                      ? {
                          role: "button",
                          tabIndex: 0,
                          "aria-label": t("openDetails", { name: copy[entry.key].name }),
                          onClick: open,
                          onKeyDown: (event: KeyboardEvent) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              open();
                            }
                          },
                        }
                      : {})}
                  >
                    {/* the tile keeps the workflow tile's colour recipe at
                        card scale — Gmail wears the coral family (its own
                        mark is red; beside the mail workflow's coral plane
                        it reads as kin), everything else the accent, the
                        platform's only two on-color pairs */}
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                        entry.slug === "gmail" || entry.slug === "outlook-mail"
                          ? "bg-danger text-on-danger shadow-[0_18px_44px_-14px_rgb(var(--danger)/0.75)]"
                          : "bg-accent text-on-accent shadow-[0_18px_44px_-14px_rgb(var(--accent)/0.75)]"
                      }`}
                      aria-hidden
                    >
                      <Icon name={entry.icon} size="lg" />
                    </span>
                    <h2 className="mt-3 text-pane-title font-semibold text-fg group-hover:text-accent">
                      {copy[entry.key].name}
                    </h2>
                    <p className="text-xs text-fg-muted">
                      {providerName(entry.provider)}
                    </p>
                    <p className="mt-1.5 flex-1 text-sm leading-6 text-fg-muted">
                      {copy[entry.key].description}
                    </p>
                    {/* the action row stops the click: a button here answers
                        its own question, never also the card's */}
                    <div className="mt-4" onClick={(event) => event.stopPropagation()}>
                      {action === null ? null : (
                        <TileControl
                          action={action}
                          labels={{
                            connect: tw("connect", { provider: providerName(entry.provider) }),
                            reconnect: tw("reconnect", { provider: providerName(entry.provider) }),
                            notConfigured: tw("notConfigured", {
                              provider: providerName(entry.provider),
                            }),
                            enableDrafts: tw("enableDrafts"),
                            reconnectDrive: t("reconnectDrive"),
                            connected: t("connected"),
                          }}
                          onBrief={() =>
                            setBriefing({ entry, reconnect: action.kind === "reconnect" })}
                          /* scope upgrades skip the briefing: the account is
                             already connected and briefed — the press is a
                             re-consent, not a first meeting */
                          onConnect={() => void connect(entry.provider)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {error ? <p role="status" className="mt-4 text-sm text-danger">{error}</p> : null}
          </div>

      {/*
        THE CONNECT BRIEFING (user directive: "when you click the one without
        connections it must show like the image that connect me … make the
        steps easier and more user friendly"). The theme's one dialog in its
        non-danger face — not a second modal to style. It says, before the
        OAuth redirect: what this integration enables, that one Google
        sign-in covers all four Google sources (so four tiles do not read as
        four accounts), and the privacy facts that are actually true here —
        per-person connection (D29), content read on demand, never in logs.
      */}
      {briefing ? (
        <ConfirmDialog
          title={copy[briefing.entry.key].name}
          danger={false}
          confirmLabel={
            briefing.reconnect
              ? tw("reconnect", { provider: providerName(briefing.entry.provider) })
              : t("connectJustForMe")
          }
          cancelLabel={t("cancel")}
          body={
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted"
                  aria-hidden
                >
                  <Icon name={briefing.entry.icon} size="lg" />
                </span>
                <p className="text-sm leading-6 text-fg-muted">
                  {copy[briefing.entry.key].description}
                </p>
              </div>
              {briefing.entry.provider === "google" ? (
                <p className="text-sm leading-6 text-fg-muted">{t("oneGoogleGrant")}</p>
              ) : null}
              <div className="well p-4">
                <p className="text-sm font-medium text-fg">{t("privacyTitle")}</p>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{t("privacyNote")}</p>
              </div>
            </div>
          }
          onConfirm={() => {
            const provider = briefing.entry.provider;
            setBriefing(null);
            void connect(provider);
          }}
          onCancel={() => setBriefing(null)}
        />
      ) : null}
    </PageContainer>
  );
}

/**
 * What a tile OFFERS, given the action decided above.
 *
 * `sentence` is a claim about the PRODUCT — the operator holds no OAuth
 * credentials for this provider — so it renders as a sentence and never as a
 * button, because a button here could not work for any person on any
 * account. Everything else genuinely does something: opens the briefing,
 * starts a re-consent, or (connected) states the fact while the card itself
 * carries the navigation.
 */
function TileControl({
  action,
  labels,
  onBrief,
  onConnect,
}: {
  action: TileAction;
  labels: {
    connect: string;
    reconnect: string;
    notConfigured: string;
    enableDrafts: string;
    reconnectDrive: string;
    connected: string;
  };
  onBrief: () => void;
  onConnect: () => void;
}) {
  if (action.kind === "sentence") {
    return (
      /* audit finding, 2026-09-02: this wore a 36px bordered rounded-full
         pill in the tile's button slot — sized to the buttons on the
         neighbouring tiles, which is exactly the shape the comment above says
         it must never take; on screen it read as a disabled control. A claim
         about the product is a sentence, and a sentence is set as copy: no
         height, no corner, nothing to mistake for something to press. (It
         was also this file's one entry in control.guard's worklist.) */
      <p className="text-xs text-fg-subtle">{labels.notConfigured}</p>
    );
  }
  if (action.kind === "connected") return <StatusDot label={labels.connected} />;
  if (action.kind === "enableDrafts" || action.kind === "reconnectDrive") {
    return (
      <button type="button" className="btn btn-sm border border-border font-medium text-fg" onClick={onConnect}>
        {action.kind === "enableDrafts" ? labels.enableDrafts : labels.reconnectDrive}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-sm border border-border font-medium text-fg" onClick={onBrief}>
      {action.kind === "connect" ? labels.connect : labels.reconnect}
    </button>
  );
}
