"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { ConfirmDialog } from "@/components/rowActions";
import { DataTable } from "@/components/DataTable";
import { IconTrash } from "@/components/icons";
import { PageContainer, PageHeader } from "@/components/scaffold";
import { useRouter } from "@/i18n/routing";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { digits, formatDate } from "@/lib/format";
import { untitledNumbers } from "@/lib/sessionTitles";

/** core's DEFAULT_PAGE, asked for explicitly so "a full page" is a fact
 *  this file can test rather than a server default it has to remember */
const HISTORY_PAGE = 50;

/**
 * Conversation history — the records as a TABLE, the same card-table
 * anatomy every other sub-page uses, beside the assistant sub-menu.
 *
 * The docked AssistantPane this page used as its reader is GONE (user
 * directive, 2026-08-21: the side-docked assistant leaves every page —
 * this was the last one standing). Clicking a record OPENS THE ASSISTANT
 * PAGE with the stored conversation (`/assistant?c=`): one assistant, one
 * home, the same thread continued wherever the person goes next. (Audit
 * pass, 2026-09-02: this header still named the presence dock's
 * `openAssistant` as the row's destination — a mechanism the orb-stands-
 * down ruling of 2026-08-27 retired on this surface; the row's own comment
 * below had the truth and the header had the old story.)
 */
export default function ConversationsPage() {
  const router = useRouter();
  const t = useTranslations("conversations");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  /** `null` = not fetched; `[]` = genuinely none. */
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  /* THE DOOR PAST THE FIRST PAGE (2026-09-06, the check-up). Core bounds the
     list at fifty (DEFAULT_PAGE) and offers `before`; the page never asked,
     so a person with sixty conversations saw fifty and a pager that ended,
     which reads exactly like a person who has had fifty. `hasMore` is what
     the last answer said: a FULL page means the server may hold older rows. */
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  /** the row awaiting the platform's are-you-sure (see the dialog below) */
  const [confirmDelete, setConfirmDelete] = useState<AssistantSession | null>(null);
  /* a removal's failure is still never swallowed — it goes to the
     notification system (orb toast + bell), not an inline span */

  /* refresh bus: archiving from anywhere (this table, the dock's agent) */
  const sessionsEpoch = useRefreshEpoch("sessions");
  useEffect(() => {
    void api.agentSessions(false, { limit: HISTORY_PAGE }).then((rows) => {
      setSessions(rows);
      setHasMore(rows.length >= HISTORY_PAGE);
    });
  }, [sessionsEpoch]);

  const loadOlder = async () => {
    const last = sessions?.[sessions.length - 1];
    /* core's keyset is `last_message_at`; a row with none sorts LAST and has
       nothing older behind it — the door closes there */
    if (!last || last.last_message_at === null || paging) return;
    setPaging(true);
    try {
      const older = await api.agentSessions(false, { before: last.last_message_at, limit: HISTORY_PAGE });
      setSessions((cur) => {
        const known = new Set((cur ?? []).map((s) => s.id));
        return [...(cur ?? []), ...older.filter((s) => !known.has(s.id))];
      });
      setHasMore(older.length >= HISTORY_PAGE && older[older.length - 1]!.last_message_at !== null);
    } catch {
      notify(t("loadMoreFailed"), "warn");
    } finally {
      setPaging(false);
    }
  };

  const numbers = untitledNumbers(sessions ?? []);
  /* ten rows, then numbers — the house rule, arriving by import. The list is
     no longer filtered (the search went in the 2026-09-02 round), so the
     pager reads the whole set. */
  const { page, setPage, pageCount, visible } = usePaged(sessions ?? []);

  return (
    <PlatformShell>
      {/* the toolbar is on TOP (2026-09-02) — AssistantMenu is a nav row now,
          so wrapping it in MenuLayout would put a row where a pane used to be
          and give the page a column it no longer has */}
      <AssistantMenu activeSlug="history" />
      {/*
        THE PLATFORM'S TABLE, not a second one (user directive, 2026-09-02:
        "make this page and table look like the meeting table with same
        features … i dont need it to look like a simple table … do this also
        for all the other pages with table in the whole platform").

        This page hand-wrote its own <table> — head, skeleton rows, dividers,
        an empty state — which is why it looked like a plain grid while the
        meetings list looked like the product. `DataTable` wears the theme's
        `.table-cards` shape now, so adopting it is what makes this page match
        every other table AND what stops there being two table implementations
        to keep in step.

        The SEARCH went with it (same directive). It filtered a list that is
        already paginated ten at a time and short for every real user, and it
        sat in the one place on the page where the eye lands first — the top
        bar's own search already covers conversations.
      */}
      {/* 12px under the toolbar — TwoPane's `!pt-3`, the board's `gap-3`.
          History, kept because it reversed: the 2026-09-02 audit found this
          page at `!pt-3` while TwoPane wore `!pt-4`, and moved it UP to match
          its siblings; on 2026-09-05 the user ruled one gap for every page
          ("an equal gap for all pages between the first sub menu and the
          content") and TwoPane came down to the board's 12 — so this page
          follows it back. Same reason both times: match the siblings. */}
      <PageContainer className="!pt-3">
          <PageHeader title={t("title")} subtitle={t("hint")} />
          <DataTable
            rows={visible}
            rowKey={(s) => s.id}
            loading={sessions === null}
            empty={t("empty")}
            /* the ASSISTANT PAGE, not the orb (2026-08-27): the dock stands
               down on this surface, so handing the conversation to it would
               be a row that clicks into nothing */
            onRowClick={(s) => router.push({ pathname: "/assistant", query: { c: s.id } })}
            /* THE TABLE'S OWN MENU, not a text link in a cell (audit finding,
               2026-09-02: an underlined red «حذف» sat in the row while every
               other DataTable — members, invitations, models, search,
               sessions — keeps its actions in the right-click menu the table
               owns; the 2026-08-25 directive took the ⋯ out of table rows
               for exactly that one menu). The actions column went with it: a
               column that held one link is a column of nothing once the link
               is a menu, and the menu's own panel already stops the press
               from reaching the row, which is what the cell's `stopClick`
               was for.

               The press still ASKS; the write lives in the dialog below (the
               platform's destructive-action rule). Removal is archive under
               the hood: nothing in the product may DELETE a conversation row
               (the audit survives), but an archived one never returns to any
               list, which is why this is a delete to the person pressing it.
               `danger` sorts it to the bottom under the theme's rule, so a
               second item can never end up beneath it. */
            menuItems={(s) => [
              {
                key: "delete",
                label: t("delete"),
                icon: <IconTrash width={14} height={14} />,
                danger: true,
                onSelect: () => setConfirmDelete(s),
              },
            ]}
            columns={[
              {
                key: "title",
                header: t("colTitle"),
                className: "font-medium text-fg",
                cell: (s) => s.title ?? t("newChat", { n: digits(numbers.get(s.id) ?? 1, locale) }),
              },
              {
                key: "date",
                header: t("colDate"),
                className: "text-fg-muted",
                cell: (s) => formatDate(s.last_message_at ?? s.created_at, locale),
              },
              {
                key: "messages",
                header: t("colMessages"),
                className: "text-fg-muted",
                cell: (s) => digits(s.message_count, locale),
              },
            ]}
          />
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
          {/* the pager walks what is loaded; this asks the server for what is
              not — the audit log's pair, for the same reason (AuditLogs.tsx) */}
          {hasMore && sessions !== null ? (
            <div className="mt-4 flex justify-center">
              <button type="button" className="btn-secondary" disabled={paging} onClick={() => void loadOlder()}>
                {paging ? tCommon("loading") : t("loadMore")}
              </button>
            </div>
          ) : null}
        </PageContainer>

      {/* The platform's one destructive-action dialog. The title names the
          conversation being removed — an untitled one is named the way the
          table names it, so the dialog and the row it came from agree.

          The failure is still SHOWN, never swallowed: the first version
          .catch(() => undefined)'d a 404 from a BFF route that did not
          exist, and the button "worked" by doing nothing (user report,
          2026-08-20). */}
      {confirmDelete !== null ? (
        <ConfirmDialog
          title={t("deleteConfirmTitle", {
            title: confirmDelete.title
              ?? t("newChat", { n: digits(numbers.get(confirmDelete.id) ?? 1, locale) }),
          })}
          body={t("deleteConfirmBody")}
          confirmLabel={t("delete")}
          cancelLabel={tCommon("cancel")}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void api
              .archiveSession(target.id, true)
              .then(() => api.agentSessions())
              .then(setSessions)
              .catch(() => notify(t("deleteFailed"), "warn"));
          }}
        />
      ) : null}
    </PlatformShell>
  );
}
