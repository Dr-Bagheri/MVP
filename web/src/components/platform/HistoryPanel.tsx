"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AssistantSession } from "@/api/types";
import { formatDate } from "@/lib/format";

/**
 * The conversation history — a STATE of the hub, never permanent chrome
 * (M22 amendment: a sidebar that renders empty for every new org is chrome
 * that costs a first impression to earn nothing). Opens over the hub,
 * dismisses back to it.
 *
 * The search filters CLIENT-side and that is correct here, not the counting
 * lie: the list is the caller's OWN sessions, served whole in one response —
 * there is no page the filter could be blind to. The members screen ruling
 * (query params, never client filtering) is about paged org-wide data; this
 * is neither.
 *
 * Rename is inline and adopts the SERVER's returned row — the title everyone
 * else would see is the one it stored (M27: the owner may rename; the system
 * never rewrites).
 */
export function HistoryPanel({
  activeId,
  onOpen,
  onClose,
}: {
  activeId?: string | undefined;
  onOpen: (sessionId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("platform");
  const locale = useLocale();
  const [sessions, setSessions] = useState<AssistantSession[] | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.agentSessions().then(setSessions);
  }, []);

  const shown = (sessions ?? []).filter(
    (s) => !query.trim() || (s.title ?? "").toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function commitRename(id: string) {
    const title = draft.trim();
    setRenaming(null);
    if (!title) return;
    setBusy(true);
    try {
      const updated = await api.renameSession(id, title);
      setSessions((prev) => prev?.map((s) => (s.id === id ? { ...s, title: updated.title } : s)) ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    try {
      await api.archiveSession(id, true);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[660px] rounded-2xl border border-border bg-surface p-3 text-start">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="input min-h-0 h-9 flex-1 text-sm"
          placeholder={t("searchConversations")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="tap grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={t("closeHistory")}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {sessions === null ? (
        <p className="px-2 py-6 text-center text-sm text-fg-muted">…</p>
      ) : shown.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-fg-muted">{t("noConversations")}</p>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
          {shown.map((s) => (
            <li key={s.id} className="group flex items-center gap-2 py-1">
              {renaming === s.id ? (
                <input
                  className="input min-h-0 h-9 flex-1 text-sm"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(s.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => void commitRename(s.id)}
                />
              ) : (
                <button
                  type="button"
                  className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-2 ${
                    s.id === activeId ? "bg-surface-2" : ""
                  }`}
                  onClick={() => onOpen(s.id)}
                >
                  <span className="block truncate text-sm text-fg">
                    {s.title || t("untitledConversation")}
                  </span>
                  <span className="block text-[11px] text-fg-muted">
                    {formatDate(s.created_at, locale)}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("renameConversation")}
                disabled={busy}
                onClick={() => {
                  setRenaming(s.id);
                  setDraft(s.title ?? "");
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </button>
              <button
                type="button"
                className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("archiveConversation")}
                disabled={busy}
                onClick={() => void archive(s.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
