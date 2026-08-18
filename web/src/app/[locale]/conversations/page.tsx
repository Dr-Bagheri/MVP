"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { AssistantPane } from "@/components/AssistantPane";
import { AssistantMenu } from "@/components/platform/AssistantMenu";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { MenuLayout, PageHeader } from "@/components/scaffold";
import { digits, formatDate } from "@/lib/format";

/**
 * Conversation history as a REAL surface (user directive, 2026-08-17: "fix
 * it using the template for sub pages — side menu with the records; pressing
 * one opens the assistant on the right side like Echo").
 *
 * The anatomy is the platform's two-pane: the records list sits where every
 * sub-page's section menu sits, and the selected conversation opens in the
 * SAME docked assistant Echo uses — with the stored thread loaded and every
 * new question continuing it. The popover this replaces was a list in a
 * bubble: no room for titles, no place to keep reading, and it closed the
 * moment you looked away.
 */
export default function ConversationsPage() {
  const t = useTranslations("conversations");
  const tPlatform = useTranslations("platform");
  const locale = useLocale();
  /** `null` = not fetched; `[]` = genuinely none. */
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void api.agentSessions().then((rows) => {
      setSessions(rows);
      // the newest conversation opens by itself: the person came here to
      // read, and an empty right side would make the surface a menu
      setSelected((current) => current ?? rows[0]?.id ?? null);
    });
  }, []);

  const shown = (sessions ?? []).filter(
    (s) => search.trim() === "" || (s.title ?? "").includes(search.trim()),
  );

  return (
    <PlatformShell>
      <div className="flex h-full min-h-0">
        {/* the standard left sub-menu (user directive, 2026-08-18) — the
            records themselves moved fully into the middle table; a page
            whose menu slot holds data reads as a different product than
            the pages beside it */}
        <div className="min-w-0 flex-1 overflow-y-auto">
        <MenuLayout menu={<AssistantMenu activeSlug="history" />}>

        {/* the records as a TABLE — the same card-table anatomy every other
            sub-page uses, at every width now that the menu slot holds the
            menu. Clicking a row opens it in the pane. */}
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
                        <th className="table-head px-4 py-3 text-start">{t("colActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shown.map((s) => (
                        <tr
                          key={s.id}
                          className={`row-link ${
                            s.id === selected ? "bg-surface-2" : ""
                          }`}
                          onClick={() => setSelected(s.id)}
                        >
                          <td className="px-4 py-2.5 font-medium text-fg">
                            {s.title ?? t("untitled")}
                          </td>
                          <td className="px-4 py-2.5 text-fg-muted">
                            {formatDate(s.updated_at ?? s.created_at, locale)}
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
                                   one never returns to any list */
                                void api
                                  .archiveSession(s.id, true)
                                  .then(() => api.agentSessions())
                                  .then((rows) => {
                                    setSessions(rows);
                                    setSelected((cur) => (cur === s.id ? (rows[0]?.id ?? null) : cur));
                                  })
                                  .catch(() => undefined);
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
        </div>

        {/*
          The SAME docked assistant Echo uses — keyed so choosing another
          record remounts it with that thread (a re-render is not a remount,
          and a pane that kept the old thread while the list highlighted a
          new one would be the calendar-store bug wearing a conversation).
        */}
        {selected !== null ? (
          <AssistantPane
            key={selected}
            page={tPlatform("hub")}
            presetSessionId={selected}
            open
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </PlatformShell>
  );
}
