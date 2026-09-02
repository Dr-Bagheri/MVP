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
import { PageContainer, PageHeader } from "@/components/scaffold";
import { useRouter } from "@/i18n/routing";
import { notify } from "@/lib/notify";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { digits, formatDate } from "@/lib/format";
import { untitledNumbers } from "@/lib/sessionTitles";

/**
 * Conversation history — the records as a TABLE, the same card-table
 * anatomy every other sub-page uses, beside the assistant sub-menu.
 *
 * The docked AssistantPane this page used as its reader is GONE (user
 * directive, 2026-08-21: the side-docked assistant leaves every page —
 * this was the last one standing). Clicking a record hands the stored
 * conversation to the presence dock (`openAssistant`): one assistant, one
 * home, the same thread continued wherever the person goes next.
 */
export default function ConversationsPage() {
  const router = useRouter();
  const t = useTranslations("conversations");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  /** `null` = not fetched; `[]` = genuinely none. */
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  /** the row awaiting the platform's are-you-sure (see the dialog below) */
  const [confirmDelete, setConfirmDelete] = useState<AssistantSession | null>(null);
  /* a removal's failure is still never swallowed — it goes to the
     notification system (orb toast + bell), not an inline span */

  /* refresh bus: archiving from anywhere (this table, the dock's agent) */
  const sessionsEpoch = useRefreshEpoch("sessions");
  useEffect(() => {
    void api.agentSessions().then(setSessions);
  }, [sessionsEpoch]);

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
              {
                key: "actions",
                header: t("colActions"),
                headClassName: "sr-only",
                stopClick: true,
                cell: (s) => (
                  <button
                    type="button"
                    className="text-xs text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                    /* the press ASKS; the write lives in the dialog below (the
                       platform's destructive-action rule). Removal is archive
                       under the hood: nothing in the product may DELETE a
                       conversation row (the audit survives), but an archived
                       one never returns to any list, which is why this is a
                       delete to the person pressing it. */
                    onClick={() => setConfirmDelete(s)}
                  >
                    {t("delete")}
                  </button>
                ),
              },
            ]}
          />
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
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
