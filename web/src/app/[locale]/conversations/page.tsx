"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout, PageHeader } from "@/components/scaffold";
import { openAssistant } from "@/lib/assistantBus";
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
  const t = useTranslations("conversations");
  const locale = useLocale();
  /** `null` = not fetched; `[]` = genuinely none. */
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  const [search, setSearch] = useState("");
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

  return (
    <PlatformShell>
      <MenuLayout menu={<AssistantMenu activeSlug="history" />}>
        <div className="mx-auto w-full max-w-content px-5 pb-16 pt-5 md:px-10 md:pt-4">
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
                    {shown.map((s) => (
                      <tr
                        key={s.id}
                        className="row-link"
                        onClick={() => openAssistant({ sessionId: s.id })}
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
                            onClick={() => {
                              /* removal = archive under the hood: nothing
                                 in the product may DELETE a conversation
                                 row (the audit survives), but an archived
                                 one never returns to any list.

                                 The failure is SHOWN, never swallowed: the
                                 first version .catch(() => undefined)'d a
                                 404 from a BFF route that did not exist,
                                 and the button "worked" by doing nothing
                                 (user report, 2026-08-20). */
                              void api
                                .archiveSession(s.id, true)
                                .then(() => api.agentSessions())
                                .then(setSessions)
                                .catch(() => notify(t("deleteFailed"), "warn"));
                            }}
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
          </div>
        </div>
      </MenuLayout>
    </PlatformShell>
  );
}
