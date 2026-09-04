"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentCardItem, JoinInviteRecord } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { digits, formatDate, personName } from "@/lib/format";
import { clearNotifications, notifyHistory, subscribeNotify, type PlatformNotice } from "@/lib/notify";

/**
 * INVITATIONS JOINED THE PANEL on 2026-09-04 (user directive: "it will go
 * to their platform as a notification and if they accept they will join …
 * after they accept they will navigate to the page of the room or to the
 * page of the online meeting").
 *
 * They are a THIRD kind beside the two below, and the difference is that they
 * are the only rows here somebody ANSWERS. A card is read; a notice is seen;
 * an invitation is accepted or declined, and until it is, it stays. So they
 * sit at the top, they are not cleared by Clear (clearing a question is not
 * answering it), and accepting navigates — which is the whole point of the
 * feature, since neither a room nor a meeting was ever unreachable.
 *
 * The top-bar notification menu (user directive, 2026-08-21: "add a
 * notification menu on top near the calendar and time at the end of the
 * menu with just a logo of notif").
 *
 * Icon only, at the bar's end. The dropdown holds two truths side by side:
 * the agent's cards (M35 — server-side, survive reload) and the session's
 * local notices from the bus (saves, tool runs, mic state — transient by
 * design; the durable record of an action is the audit log, not a toast).
 *
 * CLEAR covers the WHOLE panel (user directive, 2026-08-26: "clear must be
 * for all parts of the notification, even assistant messages"), and it
 * means two different things because the two halves are different kinds of
 * thing. Local notices are DROPPED — they were never a record. Cards are
 * MARKED READ on the server, and the panel lists only unread ones, so the
 * bell empties without anything being destroyed: the card itself still
 * lives in the conversation it came from. A dismiss that deleted the
 * agent's message would be the bell deciding what the record says.
 */
export function NotificationBell() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<AgentCardItem[]>([]);
  const [notices, setNotices] = useState<PlatformNotice[]>(() => notifyHistory());
  const [invites, setInvites] = useState<JoinInviteRecord[]>([]);
  /* the row being answered, so two quick presses cannot send two answers for
     one invitation — the second would 404 on an already-answered row and
     surface as a failure for something that worked */
  const [answering, setAnswering] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Read on mount (the badge has to be right before anyone clicks) and on
   * OPEN (so the panel shows what arrived since). Not on close: `[open]`
   * fires on both edges of the toggle, so every glance at the bell cost two
   * requests instead of one — and the second one landed on a panel nobody was
   * looking at any more.
   */
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    void api.cards().then((res) => setCards(res.cards)).catch(() => undefined);
    void api.invites().then(setInvites).catch(() => undefined);
  }, [opened]);

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

  /* the panel shows what is NEW; the read ones live on in /conversations */
  const shownCards = cards.filter((c) => !c.read);
  /* an unanswered invitation counts toward the badge: it is the one thing in
     here that is waiting on the person rather than merely addressed to them */
  const unread = shownCards.length + invites.length;

  /**
   * Answer one, and go where it points.
   *
   * The navigation is the FEATURE, not a courtesy — an invitation grants no
   * access (both a room and a meeting were always readable), so what accept
   * buys is the room appearing in your own sidebar and the app taking you
   * there. Declining stays put, because "no" is not a request to go anywhere.
   */
  async function answer(invite: JoinInviteRecord, accept: boolean): Promise<void> {
    if (answering !== null) return;
    setAnswering(invite.id);
    try {
      const done = await api.respondToInvite(invite.id, accept);
      setInvites((cur) => cur.filter((i) => i.id !== invite.id));
      setAnswering(null);
      if (!accept) return;
      setOpen(false);
      router.push(done.kind === "chat_channel"
        ? "/chat"
        : `/meetings/${encodeURIComponent(done.target_id)}`);
    } catch {
      /* LEAVE THE ROW. A refused answer that removed the invitation would
         lose the only copy of a question nobody has answered. */
      setAnswering(null);
    }
  }

  /** empty the whole panel — see the note at the top for why it is two acts */
  async function clearAll(): Promise<void> {
    clearNotifications();
    setNotices([]);
    const toMark = cards.filter((c) => !c.read);
    setCards((prev) => prev.map((c) => ({ ...c, read: true })));
    /* a refusal leaves that card unread on the server; the next open will
       show it again, which is the honest outcome — better a card that
       comes back than a bell that lies about having cleared it */
    await Promise.all(
      toMark.map((c) => api.markCardRead(c.id).catch(() => undefined)),
    );
  }

  function openCard(card: AgentCardItem) {
    if (!card.read) {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, read: true } : c)));
      void api.markCardRead(card.id).catch(() => undefined);
    }
    /*
     * A MESSAGE HAS NOWHERE TO GO (0167). Every other card points at the
     * conversation that produced it; a colleague's message has no
     * conversation — its whole content is on the row, and it is already on
     * screen. Marking it read and closing the panel is the complete action.
     *
     * Navigating anyway would be worse than useless: it would take somebody
     * who just read a one-line message to a list of assistant threads that
     * has nothing to do with it, which reads as a broken link rather than as
     * a deliberate no-op.
     */
    if (card.kind === "member_message") { setOpen(false); return; }
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
        /* 2026-09-03: the theme's icon button, not a twelfth invented size.
           This was a 36px square with the 12px MENU corner, standing in the
           bar's end cluster between a theme toggle that is `.btn btn-icon`
           (28 on a side, 8px corner) and a clock and locale pair that are
           `.btn btn-sm` (34, 8px) — one row, three shapes, and the bell was
           the only member of it that had invented its own. It escaped the
           control guard for months because `grid place-items-center` is the
           grid spelling of `flex items-center` and the guard read only the
           flex one.
           `.btn` owns the height, the corner, the centring, `.tap` and the
           transition; `border border-border` is written out because `.btn`
           draws none — which is also what keeps `hover:border-accent` from
           being a class that reads as satisfied and paints nothing.
           `relative` stays explicit: the unread badge is positioned against
           this box, and letting it inherit that from `.tap` would make the
           badge depend on the internals of a hit-area utility. */
        className="btn btn-icon relative border border-border bg-surface text-fg-muted hover:border-accent hover:text-accent"
        onClick={() => {
          /* the OPENING edge only — see the fetch effect above. Computed
             here rather than inside the updater: an updater runs twice under
             StrictMode, and a counter bumped in one would fetch twice. */
          const next = !open;
          setOpen(next);
          if (next) setOpened((n) => n + 1);
        }}
      >
        {/* 16, the size the sun/moon toggle immediately beside it draws at:
            the box is 28 now, and two icon buttons standing in one cluster
            with the same box and different glyph weights is the same
            complaint one level down. */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -end-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {/* digits with the LANGUAGE, like every other count in the
                product. It read as a Latin numeral on a Persian screen —
                pre-existing, and it now appears far more often because an
                unanswered invitation counts toward it too. */}
            {digits(unread, locale)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 top-11 z-50 max-h-[60dvh] w-[min(90vw,20rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          {shownCards.length === 0 && notices.length === 0 && invites.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-muted">{t("bellEmpty")}</p>
          ) : (
            <>
              {/* ONE Clear, at the top, for the whole panel */}
              <div className="flex items-center justify-end border-b border-border pb-1.5">
                <button
                  type="button"
                  className="tap rounded-md px-2 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() => void clearAll()}
                >
                  {t("bellClear")}
                </button>
              </div>
              {invites.length > 0 ? (
                <div className="mb-1">
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-subtle">{t("bellInvites")}</p>
                  {invites.map((invite) => (
                    <div key={invite.id} className="rounded-lg px-2 py-1.5">
                      <p className="text-xs text-fg">
                        {t(invite.kind === "chat_channel" ? "inviteToRoom" : "inviteToMeeting")}
                        {" "}
                        <bdi className="font-semibold">{invite.target_title}</bdi>
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={answering !== null}
                          onClick={() => void answer(invite, true)}
                          className="btn btn-sm bg-accent text-on-accent hover:opacity-90 disabled:opacity-50"
                        >
                          {t("inviteAccept")}
                        </button>
                        <button
                          type="button"
                          disabled={answering !== null}
                          onClick={() => void answer(invite, false)}
                          className="btn btn-sm border border-border text-fg-muted hover:text-fg disabled:opacity-50"
                        >
                          {t("inviteDecline")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {shownCards.length > 0 ? (
                <div className="mb-1">
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-subtle">{t("bellCards")}</p>
                  {shownCards.slice(0, 8).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="tap block w-full rounded-lg px-2 py-1.5 text-start text-xs text-fg hover:bg-surface-2"
                      onClick={() => openCard(card)}
                    >
                      {!card.read ? <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden /> : null}
                      {/* A MESSAGE SHOWS ITS TEXT, not its title (0167): its
                          title is empty by construction — a person sends words,
                          not a heading — so rendering `title` here would draw a
                          dated blank row and call it a notification. */}
                      <span className={card.read ? "text-fg-muted" : ""}>
                        {card.kind === "member_message" ? card.body : card.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-fg-subtle">
                        {/* who it came from, before when: a message is read as
                            "Sara said" and a digest as "last Monday" */}
                        {card.kind === "member_message" && card.from_name !== null
                          ? `${personName({ display_name: card.from_name, display_name_en: card.from_name_en }, locale)} · `
                          : ""}
                        {formatDate(card.created_at, locale)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {notices.length > 0 ? (
                <div>
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-subtle">{t("bellRecent")}</p>
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
