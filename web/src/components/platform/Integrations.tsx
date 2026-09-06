"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorProvider, ConnectorStatus, Me } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { PageContainer, Skeleton } from "@/components/scaffold";
import { DataTable, StatusDot, type Column } from "@/components/DataTable";
import { EmptyState } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { SECTION_ROW_GAP, SectionTabs } from "./sectionTabs";
import { BrandMark } from "./brandMarks";
import { ConnectDialog } from "./ConnectDialog";
import { digits, formatRelativeDate, formatTime, personName } from "@/lib/format";
import {
  INTEGRATIONS,
  foldSearch,
  providerLabelFor,
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

/** What a tile IS, decided in ONE place so its chip and its press agree. */
type TileAction =
  | { kind: "sentence" }
  | { kind: "connect" }
  | { kind: "reconnect"; status: "expired" | "revoked" }
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
  if (state.status === "not_connected") return { kind: "connect" };
  return { kind: "reconnect", status: state.status === "expired" ? "expired" : "revoked" };
}

/**
 * What a tile SHOWS and DOES: its status chip and, when it is a control, the
 * one press it answers. `control: null` is the not-configured tile — a claim
 * about the product, so nothing to press and nothing that reads as disabled.
 */
interface TileFace {
  status: string;
  tone: "success" | "muted" | "warning" | "danger";
  control: { label: string; press: () => void } | null;
}

/**
 * THE ONE TILE SHAPE (RULEBOOK R22; user directive, 2026-09-06: "like an app
 * store … smaller buttons same size each row 4 of them with their own logos
 * and just the name and their status"). A list card (`.card-row`) with a
 * floor of eight rem so a short name and a long status land on one height;
 * the mark, the name on one line, the chip — and nothing else: no
 * description, no provider line, no button inside the tile. The tile IS the
 * button, so the whole face is the hit area.
 */
const TILE = "card-row flex min-h-32 w-full flex-col items-center justify-center gap-1 text-center";

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

  /* the provider's name: the workflows catalogue's word for the two legacy
     providers, the tile's own name for a registry provider (one tile each) */
  const providerName = (provider: ConnectorProvider) => {
    const entry = INTEGRATIONS.find((row) => row.provider === provider);
    return entry ? providerLabelFor(entry, copy, tw) : provider;
  };

  /**
   * The chip and the press for one tile, from the state decided above — one
   * function, so what a tile says and what it does cannot disagree. The
   * accessible name is the ACTION with the integration's name in it («اتصال
   * جی‌میل»), never the provider's: four Google tiles are four different
   * doors, and a screen reader offered «اتصال گوگل» four times cannot tell
   * them apart.
   */
  function present(action: TileAction, entry: IntegrationEntry, name: string): TileFace {
    switch (action.kind) {
      case "sentence":
        return { status: t("statusNotConfigured"), tone: "muted", control: null };
      case "connect":
        return {
          status: t("statusNotConnected"), tone: "muted",
          control: { label: t("connectName", { name }), press: () => setBriefing({ entry, reconnect: false }) },
        };
      case "reconnect":
        return {
          status: action.status === "expired" ? t("statusExpired") : t("statusRevoked"),
          tone: action.status === "expired" ? "warning" : "danger",
          control: { label: t("reconnectName", { name }), press: () => setBriefing({ entry, reconnect: true }) },
        };
      /* scope upgrades skip the briefing: the account is already connected
         and briefed — the press is a re-consent, not a first meeting. The
         connected TABLE still lists the mailbox, so its detail page is one
         tab away; the tile's one press is the upgrade the chip names. */
      case "enableDrafts":
        return {
          status: t("statusDraftsOff"), tone: "warning",
          control: { label: t("enableDraftsTile", { name }), press: () => void connect(entry.provider) },
        };
      case "reconnectDrive":
        return {
          status: t("statusDriveOff"), tone: "warning",
          control: { label: t("reconnectDriveTile", { name }), press: () => void connect(entry.provider) },
        };
      case "connected":
        return {
          status: t("connected"), tone: "success",
          control: { label: t("openDetails", { name }), press: () => router.push(`/integrations/${entry.slug}`) },
        };
    }
  }

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
          {/* the SOURCE's own mark (brandMarks.tsx — inline, no remote brand
              asset under the CSP): two rows of one grant differ by what they
              read, and the row wears the same logo as its tile on the shelf */}
          <BrandMark
            slug={row.slug}
            className="h-8 w-8"
            fallback={(
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted" aria-hidden>
                <Icon name={row.icon} size="md" />
              </span>
            )}
          />
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
            className={SECTION_ROW_GAP}
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
            {/* THE SHELF (user directive, 2026-09-06: "the integration page
                to look like an app store with multiple options that you can
                choose to connect and smaller buttons same size each row 4 of
                them with their own logos and just the name and their status").
                Four to a row from md, two below; every tile the same shape;
                the tile IS the control — see `present()` for what each state
                shows and does. While the wire answers, four placeholders the
                tile's own size hold the row (a shelf that appears whole after
                the network makes everything under it jump, and an empty shelf
                reads as "nothing to connect"). */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {connectors === null
                ? INTEGRATIONS.map((entry) => (
                    <div key={entry.slug} className={TILE} aria-hidden>
                      <Skeleton className="h-10 w-10 rounded-xl" />
                      <Skeleton className="mt-2 h-3.5 w-24" />
                      <Skeleton className="mt-2 h-3 w-16" />
                    </div>
                  ))
                : INTEGRATIONS.map((entry) => {
                    const state = connectors.find((row) => row.provider === entry.provider);
                    const name = copy[entry.key].name;
                    return (
                      <AppTile
                        key={entry.slug}
                        slug={entry.slug}
                        icon={entry.icon}
                        name={name}
                        face={present(tileAction(entry, state), entry, name)}
                      />
                    );
                  })}
            </div>
            {error ? <p role="status" className="mt-4 text-sm text-danger">{error}</p> : null}
          </div>

      {/*
        THE CONNECT DIALOG — one door for every kind of connection
        (ConnectDialog.tsx): the OAuth briefing the user asked for on
        2026-08-28, and since 2026-09-06 the pasted-token form for Telegram,
        WhatsApp Business and an MCP server. A token connection lands here
        without leaving the page, so the shelf re-reads the connections and
        the tile turns to «متصل است» in front of the person.
      */}
      {briefing ? (
        <ConnectDialog
          entry={briefing.entry}
          reconnect={briefing.reconnect}
          onConnected={() => {
            setBriefing(null);
            void api.connectors().then(setConnectors).catch(() => undefined);
          }}
          onCancel={() => setBriefing(null)}
        />
      ) : null}
    </PageContainer>
  );
}

/**
 * One tile of the shelf. The same face whatever the state — mark, name,
 * chip — so the four in a row are the same size; only whether it is a
 * BUTTON changes. A control gets the family's pointer and hover; the
 * not-configured tile is a plain box, because a claim about the product must
 * not look like something to press (and must not look disabled either: it is
 * not a control that is off, it is not a control).
 */
function AppTile({
  slug,
  icon,
  name,
  face,
}: {
  slug: string;
  icon: IconName;
  name: string;
  face: TileFace;
}) {
  const body = (
    <>
      <BrandMark
        slug={slug}
        className="h-10 w-10"
        fallback={(
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted" aria-hidden>
            <Icon name={icon} size="lg" />
          </span>
        )}
      />
      <span className="mt-1 block w-full truncate text-sm font-semibold text-fg">{name}</span>
      <StatusDot label={face.status} tone={face.tone} />
    </>
  );
  if (face.control === null) return <div className={TILE}>{body}</div>;
  return (
    <button
      type="button"
      className={`${TILE} cursor-pointer hover:bg-surface-2`}
      aria-label={face.control.label}
      onClick={face.control.press}
    >
      {body}
    </button>
  );
}
