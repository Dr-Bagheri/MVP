"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { AssistantPane } from "@/components/AssistantPane";
import { PlatformShell } from "@/components/platform/PlatformShell";
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
        {/* the records — menu-shaped, like every sub-page's section list */}
        <nav
          aria-label={t("title")}
          className="w-full shrink-0 overflow-y-auto px-3 pb-4 md:w-menu md:border-e md:border-border"
        >
          <h1 className="px-3 pb-2 pt-4 text-pane-title font-semibold text-fg">
            {t("title")}
          </h1>
          <div className="px-3 pb-2">
            <input
              className="input h-9 min-h-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {sessions === null ? null : shown.length === 0 ? (
            <p className="px-3 py-2 text-sm text-fg-muted">{t("empty")}</p>
          ) : (
            <ul>
              {shown.map((s) => {
                const active = s.id === selected;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelected(s.id)}
                      className={`tap my-px block w-full rounded-lg px-3 py-2 text-start transition-colors ${
                        active
                          ? "bg-surface-2 text-fg"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                      }`}
                    >
                      <span className={`block truncate text-menu-item ${active ? "font-semibold" : ""}`}>
                        {s.title ?? t("untitled")}
                      </span>
                      <span className="block text-[11px] text-fg-subtle">
                        {formatDate(s.updated_at ?? s.created_at, locale)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* the records as a TABLE in the middle (user directive, round 2) —
            the same card-table anatomy every other sub-page uses, with the
            delete beside each row. Clicking a row opens it in the pane. */}
        <div className="hidden min-w-0 flex-1 overflow-y-auto md:block">
          <div className="mx-auto w-full max-w-content px-5 pb-16 pt-8 md:px-10">
            <h2 className="h-page mb-1">{t("title")}</h2>
            <p className="mb-5 text-sm text-fg-muted">{t("hint")}</p>
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
                          className={`cursor-pointer transition-colors hover:bg-surface-2 ${
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
