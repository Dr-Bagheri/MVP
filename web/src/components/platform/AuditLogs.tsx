"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { BffError } from "@/api/client";
import { AUDIT_SOURCES } from "@echo/core/vocabulary";
import type { AuditCursor, AuditEntry, AuditSource, User } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { DataTable } from "@/components/DataTable";
import { Card, Chip, EmptyState } from "@/components/ui";
import { digits, formatDate, formatTime } from "@/lib/format";

/**
 * Audit Logs (M25, Settings · COMPLIANCE) — one time-ordered feed over the
 * trail's three halves: admin actions, proposal decisions, assistant runs.
 *
 * ── Codes, never content ────────────────────────────────────────────────────
 *
 * The endpoint names every column it selects and deliberately never reads
 * `agent_run.request` or `agent_run.steps`, because those hold the prompt and
 * the tool trace — transcript excerpts and quoted documents. This screen keeps
 * that promise on its own side by rendering `detail` as labelled key/value
 * pairs rather than dumping the object: a `JSON.stringify` of whatever arrived
 * would faithfully display a content field the day one leaks in, and it would
 * look like a feature. The screen says WHAT HAPPENED. It is told nothing else,
 * and it is built so that showing something else would be a visible change
 * rather than an automatic one.
 *
 * ── Two things this screen deliberately does NOT do ─────────────────────────
 *
 * It does not resolve names. `actor_name` is joined server-side and arrives
 * with the entry; looking members up here would be a second place that maps
 * people to names, and two such places eventually disagree. A `null` there is
 * not "we couldn't find them" — core/ states it means the person was
 * tombstoned, their name emptied while the record they acted in survives. That
 * is a fact worth rendering in words, not a blank.
 *
 * It does not build cursors. `next_cursor` is opaque and goes back verbatim.
 * An earlier draft of this file paged on `entry.at + 1ms` with client-side
 * dedupe, to work around a cursor that filtered on the timestamp alone while
 * ordering by `(at, source, id)` — rows sharing an instant fell between pages
 * and vanished, and `now()` being transaction time in Postgres makes that tie
 * a certainty rather than a coincidence whenever one transaction writes two
 * audit rows. B1 replaced the cursor with the same three fields the ORDER BY
 * uses, so the workaround is gone and the whole class with it. What remains is
 * the rule that keeps it gone: **`cursor.at` is microsecond text and
 * `entry.at` is the millisecond value we display — never make one out of the
 * other.**
 *
 * ── The pager and the cursor are DIFFERENT ACTS ─────────────────────────────
 *
 * The house rule is ten rows and numbered pages (2026-08-27), and this is the
 * one surface where a pager alone cannot carry it. Everywhere else the row set
 * is complete and the numbers describe all of it; here the feed is keyset-paged
 * and has no total, so the last number only ever means "the last row we have
 * FETCHED". The two controls therefore say two different things and both are
 * kept: the numbers walk what is loaded, and «older events» asks the server for
 * more, which appends and grows the numbers.
 *
 * Folding the fetch into the pager — auto-loading when someone steps onto the
 * final page — was tried and rejected for two reasons that outlive the tests
 * that showed them. It makes a network request a side effect of NAVIGATION, so
 * the last page silently moves under the person standing on it; and it is
 * unreachable exactly when it is most needed, because a server page shorter
 * than ten rows leaves ONE page, at which point the pager renders nothing and
 * the remaining rows have no door at all. A button that is always there has
 * neither problem, and it states the one fact the numbers cannot: whether
 * anything older exists.
 */

/** One request's worth. The endpoint's own cap is 200. */
const PAGE = 50;

/** Ids are unique per SOURCE, not across the feed — the union hands back three
 *  tables' primary keys, so a React key needs both. */
const entryKey = (entry: AuditEntry) => `${entry.source}:${entry.id}`;

/**
 * Does this build know the source it was sent?
 *
 * Guards against deployment skew rather than drift — a server ahead of this
 * bundle. No type can prevent it, and the answer must never be "drop the row".
 */
const isKnownSource = (value: string): value is AuditSource =>
  (AUDIT_SOURCES as readonly string[]).includes(value);

/** `action` is a closed vocabulary for two of the three sources — and an open
 *  one for `admin_action`, whose values are whatever wrote them. Translating
 *  only what we know keeps an unrecognised code visible as a code instead of
 *  being mapped onto the nearest label that happens to exist. */
const TRANSLATABLE_ACTIONS: Record<string, readonly string[]> = {
  proposal_decision: ["approve", "reject"],
  agent_run: ["ok", "error", "running"],
  /*
   * The deletion ledger's action is `deletion_record.kind`, and db/0085
   * closes it at the column: `check (kind in ('call', 'person', 'member'))`.
   * A closed vocabulary belongs in this map — without its entry every
   * deletion row fell to the free-text branch and rendered the bare word
   * `call` in a monospace face, on a page whose whole job is to say what
   * happened. `audit.action.call` / `.person` / `.member` were already
   * authored in both locales; nothing pointed at them.
   */
  deletion: ["call", "person", "member"],
};

const TRANSLATABLE_TARGETS = ["proposal", "agent_run", "member", "org", "call", "deletion"];

/** Keys the four sources are known to build. Anything else renders under its
 *  raw name rather than being hidden — a detail we do not recognise is still a
 *  detail, and dropping it would be this screen editing the record. */
const TRANSLATABLE_DETAILS = [
  "kind", "model", "skill_id", "run_id", "tokens_in", "tokens_out", "error", "finished_at",
  /* the deletion arm's only key (core's DELETION_FEED_ARM builds
     `jsonb_build_object('reason', d.reason)`) */
  "reason",
];

/**
 * Detail keys whose value is a SENTENCE A PERSON WROTE.
 *
 * Everything else this screen shows is machine text — an id, a model name, a
 * status word — and machine text is rendered `ltr font-mono` on purpose: a
 * uuid read right-to-left is a different uuid, and a monospace face is what
 * makes one scannable.
 *
 * `reason` is not machine text. db/0085 requires it on every product
 * deletion (3–500 characters, the actor's own words), and in a
 * Persian-first product it is a Persian sentence — which was arriving
 * forced left-to-right in a Latin monospace stack: the one field on the
 * page written by a human, dressed as a hash.
 *
 * `error` deliberately stays with the codes. It is whatever the runner
 * handed the row — machine text that can carry a model id or a path — and
 * LTR isolation is the non-destructive way to show one of those.
 */
const HUMAN_TEXT_DETAILS = ["reason"];

/**
 * A detail value, AND whether it is machine text — one function, because
 * they are one decision.
 *
 * The branch that knows a value is a date is the only branch that knows it
 * has already been through `formatDate`, which gave it the reader's calendar
 * and the reader's digits. Putting that back into a Latin monospace face
 * forced left-to-right undoes exactly the work it just did: «۲۲ مرداد ۱۴۰۵»
 * is not a code and does not read like one. Same for a count through
 * `digits()`.
 *
 * So `code` is false for anything this screen FORMATTED itself and for the
 * sentences a person wrote, and true for everything that arrived opaque —
 * including an unrecognised key, which is the safe default: rendering an
 * unknown code in the document's direction can visually reorder it, while
 * rendering unknown prose left-to-right merely looks wrong.
 *
 * **Exported, and outside the component, because the half that matters is
 * unmeasurable from the DOM.** Whether a value ends up in a monospace face
 * is a computed style, and jsdom computes none — so a render assertion can
 * see the direction and never the font. Extracting the decision is the
 * answer to that ("a test that is hard to write correctly against the DOM is
 * an argument for extracting the decision, not for trusting it"): the rule
 * is asserted here, directly, and the screen is asserted to obey it.
 */
export function auditDetailValue(
  key: string,
  value: unknown,
  locale: string,
): { text: string; code: boolean } {
  if (key === "finished_at" && typeof value === "string") {
    return { text: `${formatDate(value, locale)} ${formatTime(value, locale)}`, code: false };
  }
  if (typeof value === "number") return { text: digits(value, locale), code: false };
  if (typeof value === "object") return { text: JSON.stringify(value), code: true };
  return { text: String(value), code: !HUMAN_TEXT_DETAILS.includes(key) };
}

const SOURCE_TONE: Record<AuditSource, "accent" | "info" | "neutral"> = {
  admin_action: "accent",
  proposal_decision: "info",
  agent_run: "neutral",
  deletion: "neutral",
};

export function AuditLogs() {
  const t = useTranslations("audit");
  const tAdmin = useTranslations("admin");
  const locale = useLocale();

  const [me, setMe] = useState<User | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  /** Opaque. `null` means the feed is exhausted — core/'s reliable end signal,
   *  which a short page only happens to imply. */
  const [cursor, setCursor] = useState<AuditCursor | null>(null);
  const [source, setSource] = useState<AuditSource | "">("");
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [failed, setFailed] = useState<BffError | Error | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "owner";

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const page = await api.audit({ limit: PAGE, ...(source ? { source } : {}) });
      setEntries(page.entries);
      setCursor(page.next_cursor);
    } catch (error) {
      setFailed(error as Error);
      /*
       * Rows are CLEARED on failure. Leaving the previous page on screen under
       * an error banner would show a stale feed that reads as current — and on
       * this surface "these are the events" is the entire claim being made.
       */
      setEntries([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setPaging(true);
    try {
      // handed back exactly as received — see the header
      const page = await api.audit({ limit: PAGE, cursor, ...(source ? { source } : {}) });
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.next_cursor);
    } catch (error) {
      setFailed(error as Error);
    } finally {
      setPaging(false);
    }
  }, [cursor, source]);

  /* the pager walks what is LOADED; the cursor is the button's job */
  const { page, setPage, pageCount, visible } = usePaged(entries);

  /**
   * Who acted — and `null` says something specific.
   *
   * core/ resolves the name at read time and returns `null` only when the
   * actor no longer exists (M24's true delete empties the person and keeps the
   * row so references still resolve). So this renders a stated fact, not a
   * failed lookup, and it keeps the id visible because the id is the thing that
   * still links the record together.
   */
  const actorCell = (entry: AuditEntry) =>
    entry.actor_name ? (
      <span className="font-medium text-fg">{entry.actor_name}</span>
    ) : (
      <span className="text-fg-muted" title={t("actorRemovedNote")}>
        <span className="block text-xs">{t("actorRemoved")}</span>
        {/* `--fg-subtle`, not `fg-muted/80`. The platform HAS a third,
            quieter foreground — round 2's grouped-menu ruling minted it and
            `verify-pairs.mjs` asserts subtle-recedes-from-muted in both
            themes. A hand-rolled alpha is a fourth tone nothing measures,
            and it drifts the moment either token moves. */}
        <span className="ltr block font-mono text-[11px] text-fg-subtle">
          {entry.actor_id.slice(0, 8)}
        </span>
      </span>
    );

  const actionLabel = (entry: AuditEntry) =>
    TRANSLATABLE_ACTIONS[entry.source]?.includes(entry.action) ? (
      <span className="text-fg">{t(`action.${entry.action}`)}</span>
    ) : (
      <span className="ltr font-mono text-xs text-fg">{entry.action}</span>
    );

  const targetCell = (entry: AuditEntry) => (
    <>
      {TRANSLATABLE_TARGETS.includes(entry.target_type) ? (
        <span className="text-fg-muted">{t(`target.${entry.target_type}`)}</span>
      ) : (
        <span className="ltr font-mono text-xs text-fg-muted">{entry.target_type}</span>
      )}
      {/* `--fg-subtle` here too — see actorCell */}
      {entry.target_id ? (
        <span className="ltr block font-mono text-[11px] text-fg-subtle">
          {entry.target_id.slice(0, 8)}
        </span>
      ) : null}
    </>
  );

  /**
   * `detail`, as labelled pairs — never as a dumped object.
   *
   * `null` values are dropped because the producer builds a fixed set of keys
   * per source and fills the ones that apply: a null `error` on a successful
   * run is the absence of an error, not a fact worth a row. A zero is NOT
   * dropped — `tokens_out: 0` is a measurement, and the "not measured must
   * never render as zero" rule cuts both ways.
   */
  const detailPairs = (entry: AuditEntry) =>
    Object.entries(entry.detail).filter(([, value]) => value !== null && value !== undefined);

  /*
   * `me === null` renders nothing rather than the refusal: identity in flight
   * and identity refused are different states, and showing an admin a locked
   * door for 200ms teaches them the product doubts them.
   */
  if (me !== null && !isAdmin) {
    return (
      /* the platform's ONE refusal card (management/models, /users, /server,
         /invitations, /privileges all render exactly this): a Card, an
         `h-section` heading, the note under it. This screen had a
         hand-rolled div with its own border, its own ground and its own
         type scale — the single most-repeated shape on the product wearing
         a different face on one page. */
      <Card>
        <h2 className="h-section">{tAdmin("adminOnly")}</h2>
        <p className="mt-1 text-sm leading-7 text-fg-muted">{t("adminOnlyNote")}</p>
      </Card>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs leading-6 text-fg-muted">{t("codesOnly")}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label>
          <span className="sr-only">{t("filterSource")}</span>
          <select
            /* the THEME's field. It carried `h-11 min-h-0 py-0 text-sm md:h-10`
               — four overrides of the one class whose whole job is to say how
               tall a field is, which is why this dropdown was the one control
               on the page that did not match the platform. */
            className="input w-auto"
            value={source}
            onChange={(event) => setSource(event.target.value as AuditSource | "")}
          >
            <option value="">{t("filterAll")}</option>
            {AUDIT_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`source.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        /* the same failure banner Management · Server renders, and the same
           way it renders it: a Card tinted danger, not a second hand-drawn
           box that happens to pick the same two tokens */
        <Card className="mb-4 border-danger/40 bg-danger/10">
          <p className="text-sm font-medium text-fg">{t("failed")}</p>
          <button
            className="btn-secondary btn-sm mt-2"
            onClick={() => void load()}
          >
            {t("retry")}
          </button>
        </Card>
      ) : null}

      {/*
        2026-09-03: the frame before the data, and it is the TABLE's frame.
        The loading state was a hand-rolled Card of six four-bar rows standing
        in for an unboxed five-column table — the right idea drawn at the wrong
        size, so the page moved twice: once when the placeholder appeared and
        again when a differently-shaped table replaced it. `loading` on
        DataTable draws the real header, the real column widths and the real
        borders with skeleton cells inside them, which is the whole point of
        the prop existing.

        It also puts the empty sentence where it belongs: DataTable renders
        `empty` only once `loading` is false, so «هنوز رویدادی ثبت نشده است» —
        a claim that nothing has EVER happened in this organization — can no
        longer appear while nobody has looked yet.

        A FAILED read with nothing to show gets neither: the banner above
        already says what happened, and an empty-record sentence beneath it
        would be a second, contradictory answer to the same question.
      */}
      {failed && entries.length === 0 ? null : (
        <>
          {/*
            The theme's ONE table (user directive, 2026-08-28: "fix the
            table with same rule of the theme") — the hand-rolled <table>
            predated DataTable and was the last surface wearing its own
            skin. The cells are unchanged. The Card that used to frame it is
            gone too (audit finding, 2026-09-02): DataTable's rows are cards
            of their own now, and the members table renders it bare — so the
            frame here was the one outer box left on the platform.
          */}
          <DataTable
            rows={visible}
            loading={loading}
            /* six, matching the placeholder this replaced and roughly a
               screenful — the reserved space is a promise about the size of
               what is coming */
            loadingRows={6}
            empty={<EmptyState text={source ? t("emptyFiltered") : t("empty")} />}
            rowKey={entryKey}
            columns={[
              {
                key: "when",
                header: t("colWhen"),
                cell: (entry) => (
                  <span className="block text-xs text-fg-muted">
                    <span className="block">{formatDate(entry.at, locale)}</span>
                    <span className="block">{formatTime(entry.at, locale)}</span>
                  </span>
                ),
              },
              { key: "who", header: t("colWho"), cell: (entry) => actorCell(entry) },
              {
                key: "what",
                header: t("colWhat"),
                cell: (entry) => {
                  /*
                    An unknown source is RENDERED, never skipped. A build
                    that quietly dropped entries it did not recognise would
                    make a deployment skew look like an organization where
                    nothing happened — and the entries most likely to be new
                    are the ones most worth seeing.
                  */
                  const known = isKnownSource(entry.source);
                  return (
                    <>
                      {known ? (
                        <Chip tone={SOURCE_TONE[entry.source]}>
                          {t(`source.${entry.source}`)}
                        </Chip>
                      ) : (
                        <span title={t("unknownSourceNote")}>
                          <Chip tone="warning">{t("unknownSource")}</Chip>
                          <span className="ltr mt-1 block font-mono text-[11px] text-fg-muted">
                            {entry.source}
                          </span>
                        </span>
                      )}
                      <span className="mt-1 block text-xs">{actionLabel(entry)}</span>
                    </>
                  );
                },
              },
              {
                key: "target",
                header: t("colTarget"),
                cell: (entry) => <span className="text-xs">{targetCell(entry)}</span>,
              },
              {
                key: "detail",
                header: t("colDetail"),
                cell: (entry) => (
                  <ul className="space-y-0.5">
                    {detailPairs(entry).map(([key, value]) => {
                      const { text, code } = auditDetailValue(key, value, locale);
                      return (
                        <li key={key} className="text-xs leading-5 text-fg-muted">
                          <span>
                            {TRANSLATABLE_DETAILS.includes(key) ? (
                              t(`detail.${key}`)
                            ) : (
                              <span className="ltr font-mono">{key}</span>
                            )}
                          </span>
                          <span>: </span>
                          {code ? (
                            <span className="ltr font-mono text-fg">{text}</span>
                          ) : (
                            /* `dir="auto"` rather than a fixed direction: the
                               value picks its own from its first strong
                               character, so a Persian reason reads RTL and an
                               English one written by the same admin reads LTR
                               — and either way the browser ISOLATES it, so it
                               cannot drag the label's punctuation around it. */
                            <span className="text-fg" dir="auto">{text}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ),
              },
            ]}
          />
          {/* Both of these are ANSWERS, so neither renders before one arrives.
              «به ابتدای سوابق رسیدید» is a statement the SERVER makes — that
              there is nothing older — and it is the last thing that should be
              said over a feed nobody has read yet; the pager's numbers would
              likewise be describing rows that do not exist. This is the same
              rule as the empty sentence above, and the reason the skeleton
              stands in for the rows and not for these. */}
          {!loading && entries.length > 0 ? (
            <>
              <Pagination page={page} pageCount={pageCount} onPage={setPage} />

              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {cursor ? (
                  <button
                    className="btn-secondary h-10 min-h-0 px-4 text-sm"
                    disabled={paging}
                    onClick={() => void loadMore()}
                  >
                    {paging ? t("loading") : t("loadMore")}
                  </button>
                ) : (
                  /* the end is a FACT the server states, and the numbers cannot */
                  <p className="text-xs text-fg-muted">{t("atEnd")}</p>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
