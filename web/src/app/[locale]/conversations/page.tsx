"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { Pagination, usePaged } from "@/components/Pagination";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { ConfirmDialog } from "@/components/rowActions";
import { MenuLayout, PageContainer, PageHeader, Skeleton } from "@/components/scaffold";
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
  const [search, setSearch] = useState("");
  /** the row awaiting the platform's are-you-sure (see the dialog below) */
  const [confirmDelete, setConfirmDelete] = useState<AssistantSession | null>(null);
  /* a removal's failure is still never swallowed — it goes to the
     notification system (orb toast + bell), not an inline span */

  /* refresh bus: archiving from anywhere (this table, the dock's agent) */
  const sessionsEpoch = useRefreshEpoch("sessions");
  useEffect(() => {
    void api.agentSessions().then(setSessions);
  }, [sessionsEpoch]);

  const shown = (sessions ?? []).filter(
    (s) => search.trim() === "" || (s.title ?? "").includes(search.trim()),
  );
  /* numbered over the FULL list, not the filtered one — a search must not
     renumber what it merely hides */
  const numbers = untitledNumbers(sessions ?? []);
  /* this table is markup rather than DataTable, so the house rule arrives by
     import: ten rows, then numbers. `shown` is the FILTERED list, which is
     what makes the pager's clamp load-bearing here — typing in the search box
     shortens the set under whatever page the person is standing on. */
  const { page, setPage, pageCount, visible } = usePaged(shown);

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="history" />}>
        <PageContainer>
          <PageHeader title={t("title")} subtitle={t("hint")} />
          <div className="mb-4 max-w-xs">
            <input
              className="input h-9 min-h-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="rounded-lg border border-border bg-surface">
            {sessions === null ? null : shown.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">{t("empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="table-head px-4 py-3 text-start">{t("colTitle")}</th>
                      <th className="table-head px-4 py-3 text-start">{t("colDate")}</th>
                      <th className="table-head px-4 py-3 text-start">{t("colMessages")}</th>
                      {/* no visible ACTIONS title (2026-08-25, all tables) */}
                      <th className="table-head px-4 py-3 text-start">
                        <span className="sr-only">{t("colActions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {/* the frame is structure and renders with the page; only
                        the rows wait (the platform's loading rule) */}
                    {sessions === null
                      ? Array.from({ length: 5 }, (_, i) => (
                          <tr key={`skeleton-${i}`}>
                            <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                            <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                            <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                          </tr>
                        ))
                      : null}
                    {visible.map((s) => (
                      <tr
                        key={s.id}
                        className="row-link"
                        /*
                          The ASSISTANT PAGE, not the orb (user directive,
                          2026-08-27: "when you go history, the main ai
                          assistant should be open not the orb"). The dock
                          stands down on this surface now, so handing the
                          conversation to it would be a row that clicks into
                          nothing — the two halves of that directive are one
                          change, and this is the other half.
                        */
                        onClick={() => router.push({
                          pathname: "/assistant", query: { c: s.id },
                        })}
                      >
                        <td className="px-4 py-2.5 font-medium text-fg">
                          {s.title ?? t("newChat", { n: digits(numbers.get(s.id) ?? 1, locale) })}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {formatDate(s.last_message_at ?? s.created_at, locale)}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {digits(s.message_count, locale)}
                        </td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="text-xs text-danger/80 underline-offset-2 hover:text-danger hover:underline"
                            /* the press ASKS; the write lives in the dialog
                               below (the platform's destructive-action rule —
                               see confirm.guard.test.ts). Removal is archive
                               under the hood: nothing in the product may
                               DELETE a conversation row (the audit survives),
                               but an archived one never returns to any list,
                               which is why this is a delete to the person
                               pressing it and gets asked about like one. */
                            onClick={() => setConfirmDelete(s)}
                          >
                            {t("delete")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} pageCount={pageCount} onPage={setPage} className="pb-3" />
          </div>
        </PageContainer>
      </MenuLayout>

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
