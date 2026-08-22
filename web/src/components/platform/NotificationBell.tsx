"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCardItem } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { formatDate } from "@/lib/format";
import { clearNotifications, notifyHistory, subscribeNotify, type PlatformNotice } from "@/lib/notify";

/**
 * The top-bar notification menu (user directive, 2026-08-21: "add a
 * notification menu on top near the calendar and time at the end of the
 * menu with just a logo of notif").
 *
 * Icon only, at the bar's end. The dropdown holds two truths side by side:
 * the agent's cards (M35 — server-side, survive reload) and the session's
 * local notices from the bus (saves, tool runs, mic state — transient by
 * design; the durable record of an action is the audit log, not a toast).
 */
export function NotificationBell() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<AgentCardItem[]>([]);
  const [notices, setNotices] = useState<PlatformNotice[]>(() => notifyHistory());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.cards().then((res) => setCards(res.cards)).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    return subscribeNotify(() => setNotices(notifyHistory()));
  }, []);

  /** click-away closes — a menu that only closes on its own button lingers */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unread = cards.filter((c) => !c.read).length;

  function openCard(card: AgentCardItem) {
    if (!card.read) {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, read: true } : c)));
      void api.markCardRead(card.id).catch(() => undefined);
    }
    setOpen(false);
    router.push("/conversations");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("bellLabel")}
        aria-expanded={open}
        title={t("bellLabel")}
        className="tap relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-fg-muted transition-colors hover:border-accent hover:text-accent"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -end-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 top-11 z-50 max-h-[60dvh] w-[min(90vw,20rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          {cards.length === 0 && notices.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-muted">{t("bellEmpty")}</p>
          ) : (
            <>
              {cards.length > 0 ? (
                <div className="mb-1">
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-subtle">{t("bellCards")}</p>
                  {cards.slice(0, 8).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="tap block w-full rounded-lg px-2 py-1.5 text-start text-xs text-fg hover:bg-surface-2"
                      onClick={() => openCard(card)}
                    >
                      {!card.read ? <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden /> : null}
                      <span className={card.read ? "text-fg-muted" : ""}>{card.title}</span>
                      <span className="mt-0.5 block text-[10px] text-fg-subtle">
                        {formatDate(card.created_at, locale)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {notices.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between">
                    <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-subtle">{t("bellRecent")}</p>
                    <button
                      type="button"
                      className="tap rounded-md px-2 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      onClick={() => {
                        clearNotifications();
                        setNotices([]);
                      }}
                    >
                      {t("bellClear")}
                    </button>
                  </div>
                  {notices.slice(0, 8).map((notice) => (
                    <p
                      key={notice.id}
                      className={`px-2 py-1.5 text-xs ${notice.kind === "warn" ? "text-warning" : "text-fg-muted"}`}
                    >
                      {notice.text}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
