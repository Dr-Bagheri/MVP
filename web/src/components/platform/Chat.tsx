"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { openChatLive, mergeBySeq, type ChatLiveState } from "@/lib/chatLive";
import { shouldStick } from "@/lib/threadFollow";
import type { ChatChannelRecord, ChatMessageRecord, OrgPersonRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import { InvitePeople } from "./InvitePeople";
import { AgentAvatar } from "./AgentAvatar";
import { KebabMenu } from "@/components/rowActions";
import { SkeletonLines } from "@/components/scaffold";
import { IconCheck, IconClose, IconPeople3, IconPlus, IconTrash } from "@/components/icons";
import { digits } from "@/lib/format";
import { MessageRow } from "./chat/MessageRow";
import { Composer } from "./chat/Composer";

/**
 * THE TEAM CHANNEL (0184; its actions and invitations 0189).
 *
 * ── THE ROOMS ARE A TOP SUB-MENU ──────────────────────────────────────────
 *
 * User directive, 2026-09-04: "put the room and its plus option in the sub
 * menu top like the tasks with the same look."
 *
 * They were a left rail. Every other list surface in this product — tasks,
 * meetings, projects — puts its filters and its `+` in a row of chips above
 * the content, and a rail here made chat the one screen whose navigation sat
 * somewhere else. The chips carry what the rail did: the name, bold when
 * unread, and a number when you were named.
 *
 * ── THE ROOM IS A FIXED BOX ───────────────────────────────────────────────
 *
 * "Make the size of the chat box fixed, and if they continue chatting it must
 * go to scroll mode inside itself."
 *
 * A height that grows with the conversation moves everything below it and
 * eventually takes the composer off the bottom of the screen — so the box is
 * a fixed height and the messages scroll inside it. The ceiling is capped
 * against the viewport as well, because "fixed" on a 13-inch laptop must not
 * mean "taller than the window".
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 *
 * Typing indicators between PEOPLE (highest fan-out, lowest value — the
 * vendor that invented the pattern has stranded its API) and read receipts
 * (there is no mechanism by which member B learns member A's position; even
 * Slack's own mark broadcasts to your own devices only).
 */

/* FIXED, and capped: 34rem is the box, and the cap keeps it inside a short
   window. Two numbers rather than one because they answer different
   questions — how big should this be, and what must it never exceed. */
const ROOM_HEIGHT = "h-[34rem] max-h-[calc(100vh-14rem)]";

export function Chat({ meId, isAdmin, people }: {
  meId: string | null;
  isAdmin: boolean;
  people: OrgPersonRecord[];
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [channels, setChannels] = useState<ChatChannelRecord[] | null | "failed">(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[] | null>(null);
  const [live, setLive] = useState<ChatLiveState>("off");
  const [typing, setTyping] = useState<string | null>(null);
  const [failedAgent, setFailedAgent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const epoch = useRefreshEpoch("chat");
  const loadChannels = useCallback(() => {
    void api.chatChannels().then(setChannels).catch(() => setChannels("failed"));
  }, []);
  useEffect(loadChannels, [loadChannels, epoch]);

  /**
   * THE ROOM THE READER JUST LEFT, and why a ref rather than state.
   *
   * User report, twice: deleting a room emptied the box for one frame and the
   * old conversation came straight back; a reload fixed it. The cause is the
   * effect below. `leaveRoom` sets `current` to null, but `channels` is still
   * the STALE array that contains the room — so this effect ran, found it at
   * index 0, and selected it again. The archive had already landed; only the
   * list had not caught up.
   *
   * A ref, because nothing renders from it: it is a note about an action the
   * person took, read once by an effect, and making it state would re-run the
   * effect it exists to suppress.
   */
  const dismissed = useRef(false);

  /* the first room, once — and NOT after the reader has left one. Not
     `current ?? channels[0]` at render either: that would move somebody to
     another room the moment one is archived, which reads as the app losing
     their place. */
  useEffect(() => {
    if (dismissed.current) return;
    if (current !== null || !Array.isArray(channels) || channels[0] === undefined) return;
    setCurrent(channels[0].id);
  }, [channels, current]);

  /** the newest seq we hold — the cursor every catch-up read starts from */
  const tip = useRef(0);
  const currentRef = useRef<string | null>(null);
  currentRef.current = current;

  const loadMessages = useCallback((channelId: string, mode: "open" | "catchup") => {
    const after = mode === "catchup" ? tip.current : undefined;
    void api.chatMessages(channelId, after === undefined ? undefined : { after })
      .then((rows) => {
        /* the answer may arrive after the person moved rooms — dropping it
           is the whole point of the check, because merging it would put one
           room's messages under another's name */
        if (currentRef.current !== channelId) return;
        setMessages((cur) => (mode === "open" ? rows : mergeBySeq(cur ?? [], rows)));
        for (const row of rows) tip.current = Math.max(tip.current, row.seq);
      })
      .catch(() => { if (mode === "open") setMessages([]); });
  }, []);

  useEffect(() => {
    if (current === null) return;
    tip.current = 0;
    setMessages(null);
    setTyping(null);
    setFailedAgent(null);
    setReplyTo(null);
    loadMessages(current, "open");
  }, [current, loadMessages]);

  /* ONE stream for the whole org, demultiplexed here. A stream per room would
     hit the browser's six-connection HTTP/1.1 ceiling with four rooms and two
     tabs open. */
  useEffect(() => openChatLive({
    onState: setLive,
    onPoll: () => { if (currentRef.current !== null) loadMessages(currentRef.current, "catchup"); },
    onEvent: (event) => {
      if (event.type === "message" || event.type === "edited") {
        if (event.message.channel_id !== currentRef.current) {
          /* another room moved — the badge is the room list's business */
          loadChannels();
          return;
        }
        setMessages((cur) => mergeBySeq(cur ?? [], [event.message]));
        tip.current = Math.max(tip.current, event.message.seq);
        if (event.message.author_kind === "agent") setTyping(null);
        return;
      }
      if (event.channel_id !== currentRef.current) return;
      if (event.type === "agent_typing") { setFailedAgent(null); setTyping(event.handle); }
      if (event.type === "agent_failed") { setTyping(null); setFailedAgent(event.handle); }
    },
  }), [loadMessages, loadChannels]);

  /* ── the read cursor ─────────────────────────────────────────────────
     Debounced, and acknowledged EXPLICITLY rather than as a side effect of
     rendering: the unread mark has to stay where it is while somebody reads
     the messages under it. */
  const acked = useRef(0);
  useEffect(() => {
    if (current === null || messages === null || messages.length === 0) return;
    const newest = messages[messages.length - 1]!.seq;
    if (newest <= acked.current) return;
    const timer = window.setTimeout(() => {
      acked.current = newest;
      void api.markChatRead(current, newest).then(loadChannels).catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [current, messages, loadChannels]);

  /* ── stick to the bottom ─────────────────────────────────────────────
     `threadFollow`'s rule, not a second one: follow while the reader is at
     the foot, and stop the moment they scroll up to read something. */
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useEffect(() => {
    const box = scroller.current;
    if (box === null || !stick.current) return;
    box.scrollTop = box.scrollHeight;
  }, [messages, typing]);

  const channel = useMemo(
    () => (Array.isArray(channels) ? channels.find((c) => c.id === current) ?? null : null),
    [channels, current],
  );

  const send = async (body: string) => {
    if (current === null) return;
    const answering = replyTo;
    setReplyTo(null);
    try {
      const message = await api.postChatMessage(current, body, answering?.id ?? null);
      setMessages((cur) => mergeBySeq(cur ?? [], [message]));
      tip.current = Math.max(tip.current, message.seq);
      stick.current = true;
    } catch {
      /* PUT THE QUOTE BACK. A refused send that silently forgot what it was
         answering leaves the person to retype into a room where their next
         message replies to nothing. */
      setReplyTo(answering);
      setError(t("sendFailed"));
    }
  };

  /**
   * Stand in no room.
   *
   * One function because the two callers had the same bug: deleting a room
   * cleared `current` and left `messages` holding the room's words, so the
   * box went on showing a conversation whose room was gone — and leaving did
   * not even clear the selection. Everything the box draws is reset here,
   * including the read cursor, because the next room's cursor must not
   * inherit this one's.
   */
  const leaveRoom = () => {
    /* FIRST, because everything below is undone by the auto-select effect
       until this is set */
    dismissed.current = true;
    setCurrent(null);
    setMessages([]);
    setReplyTo(null);
    setTyping(null);
    setFailedAgent(null);
    tip.current = 0;
    acked.current = 0;
  };

  const react = (message: ChatMessageRecord, emoji: string, on: boolean) => {
    void api.reactToChatMessage(message.id, emoji, on)
      .then((updated) => setMessages((cur) => mergeBySeq(cur ?? [], [updated])))
      .catch(() => setError(t("writeFailed")));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── the rooms, as the top sub-menu ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("channels")}>
          {channels === null ? (
            <span className="text-xs text-fg-subtle">{t("loadingRooms")}</span>
          ) : channels === "failed" ? (
            <span className="text-xs text-fg-muted">{t("readFailed")}</span>
          ) : channels.length === 0 ? (
            <span className="text-xs text-fg-subtle">{t("noChannels")}</span>
          ) : channels.map((room) => {
            const unread = room.last_seq > room.last_read_seq;
            return (
              <button
                key={room.id}
                type="button"
                role="tab"
                aria-selected={room.id === current}
                onClick={() => { dismissed.current = false; setCurrent(room.id); }}
                className={`btn btn-sm gap-1.5 border font-medium ${
                  room.id === current
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                <span aria-hidden className="text-fg-subtle">#</span>
                {/* BOLD is the unread state — no dot beside it, because a bold
                    chip with a dot is a third state nobody can name */}
                <bdi className={unread ? "font-bold text-fg" : ""}>{room.name}</bdi>
                {room.mention_count > 0 ? (
                  <span className="badge-num rounded-md bg-danger px-1.5 text-[10px] font-bold text-on-accent">
                    {digits(room.mention_count, locale)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          {/* ADDING PEOPLE IS AN ADMIN'S (0189, the directive's own words).
              Absent rather than disabled: a greyed button is a promise the
              product will not keep for this person. */}
          {isAdmin && channel !== null ? (
            <button type="button" onClick={() => setInviting(true)}
              className="btn btn-sm gap-1.5 border border-border text-fg-muted hover:text-fg">
              <IconPeople3 width={12} height={12} />
              {t("addPeople")}
            </button>
          ) : null}
          <button type="button" onClick={() => setCreating(true)}
            className="btn btn-sm gap-1.5 bg-accent text-on-accent hover:opacity-90">
            <IconPlus width={12} height={12} />
            {t("newChannel")}
          </button>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* ── the room: a FIXED box that scrolls inside itself ─────────── */}
      <section className={`tile flex ${ROOM_HEIGHT} flex-col`} aria-label={t("room")}>
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-fg">
              <span aria-hidden className="text-fg-subtle">#</span> <bdi>{channel?.name ?? "—"}</bdi>
            </h1>
            {channel !== null && channel.topic !== "" ? (
              <p className="truncate text-[11px] text-fg-muted"><bdi>{channel.topic}</bdi></p>
            ) : null}
          </div>
          {/* the delivery lane, named. "polling" is a real state a person can
              act on, and hiding it would make a working fallback look like a
              fault. */}
          <span className={`badge-num rounded-lg px-2 py-1 text-[10px] ${
            live === "live" ? "bg-success/10 text-success"
              : live === "polling" ? "bg-warning/10 text-warning"
                : "bg-surface-2 text-fg-subtle"
          }`}>
            {t(`live_${live}`)}
          </span>
          {channel !== null ? (
            <KebabMenu
              label={t("roomOptions")}
              items={[
                {
                  key: "join",
                  label: channel.joined ? t("leave") : t("join"),
                  icon: <IconCheck width={12} height={12} />,
                  onSelect: () => {
                    void api.setChatJoined(channel.id, !channel.joined)
                      .then(() => {
                        /* LEAVING EMPTIES THE BOX (user directive). Standing
                           in a room you have just left, still reading it, is
                           the control reporting that it did nothing. */
                        if (channel.joined) leaveRoom();
                        loadChannels();
                      })
                      .catch(() => setError(t("writeFailed")));
                  },
                },
                {
                  key: "delete",
                  /* «حذف اتاق», not «بایگانی اتاق» (user directive: "change
                     the text for delete, now it's archive it"). The schema
                     still archives — a room's messages are a record and this
                     product does not destroy those — but the word on the menu
                     names what the person gets, and what they get is a room
                     that is gone. */
                  label: t("deleteRoom"),
                  icon: <IconTrash width={12} height={12} />,
                  danger: true,
                  onSelect: () => {
                    void api.updateChatChannel(channel.id, { archived: true })
                      .then(() => { leaveRoom(); loadChannels(); })
                      .catch(() => setError(t("writeFailed")));
                  },
                },
              ]}
            />
          ) : null}
        </header>

        <div
          ref={scroller}
          onScroll={(e) => { stick.current = shouldStick(e.currentTarget); }}
          role="log"
          aria-label={t("messages")}
          aria-live="polite"
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
        >
          {current === null ? (
            /* NOT «no messages yet» — that is a claim about a room, and there
               is no room. The two nothings are different and the copy says
               which one this is. */
            <p className="py-10 text-center text-xs text-fg-subtle">{t("noRoomChosen")}</p>
          ) : messages === null ? (
            <SkeletonLines lines={5} />
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-fg-subtle">{t("emptyRoom")}</p>
          ) : (
            messages.map((message, i) => (
              <MessageRow
                key={message.id}
                message={message}
                previous={messages[i - 1] ?? null}
                people={people}
                meId={meId}
                locale={locale}
                onReply={setReplyTo}
                onReact={react}
              />
            ))
          )}
          {typing !== null ? (
            <p className="flex items-center gap-2 py-1.5 text-[11px] text-fg-muted">
              <AgentAvatar handle={typing} size="sm" />
              {t("agentThinking", { name: typing })}
              <span className="inline-flex gap-0.5" aria-hidden>
                <span className="h-1 w-1 animate-pulse rounded-full bg-fg-subtle" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-fg-subtle" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-fg-subtle" />
              </span>
            </p>
          ) : null}
          {failedAgent !== null ? (
            /* AN ANNOTATION, NEVER A MESSAGE. A tidy apology written into the
               room would be indistinguishable a week later from something the
               agent said — the honest record is the question standing there
               unanswered. */
            <p role="status" className="py-1.5 text-[11px] text-warning">
              {t("agentFailed", { name: failedAgent })}
            </p>
          ) : null}
        </div>

        <Composer
          disabled={current === null}
          people={people}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={send}
        />
      </section>

      {creating ? (
        <NewChannelDialog
          onClose={() => setCreating(false)}
          onCreated={(room) => {
            dismissed.current = false;
            setCreating(false);
            setCurrent(room.id);
            loadChannels();
          }}
          onFailed={() => { setCreating(false); setError(t("writeFailed")); }}
        />
      ) : null}

      {inviting && channel !== null ? (
        <InvitePeople
          kind="chat_channel"
          targetId={channel.id}
          meId={meId}
          onClose={() => setInviting(false)}
          onFailed={() => { setInviting(false); setError(t("writeFailed")); }}
        />
      ) : null}
    </div>
  );
}

function NewChannelDialog({ onClose, onCreated, onFailed }: {
  onClose: () => void;
  onCreated: (channel: ChatChannelRecord) => void;
  onFailed: () => void;
}) {
  const t = useTranslations("chat");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(false);

  return (
    <Overlay onClose={onClose} label={t("newChannel")} size="sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("newChannel")}</h2>
        <button type="button" onClick={onClose} className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("close")}>
          <IconClose width={14} height={14} />
        </button>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("channelName")}</span>
          <input autoFocus value={name} maxLength={80}
            onChange={(e) => { setName(e.target.value); setTaken(false); }}
            placeholder={t("channelNamePlaceholder")} className="input w-full" />
          {taken ? (
            <span role="alert" className="mt-1 block text-[11px] text-danger">{t("nameTaken")}</span>
          ) : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">{t("channelTopic")}</span>
          <input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)}
            placeholder={t("channelTopicPlaceholder")} className="input w-full" />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="btn text-fg-muted hover:text-fg">
          {tCommon("cancel")}
        </button>
        <button
          type="button"
          disabled={name.trim() === "" || busy}
          onClick={() => {
            setBusy(true);
            void api.createChatChannel({ name: name.trim(), topic: topic.trim() })
              .then(onCreated)
              .catch((error: unknown) => {
                setBusy(false);
                /* the server names the field; a conflict belongs ON it, not
                   in a toast that leaves the person guessing which input */
                if ((error as { code?: string }).code === "chat_name_taken") setTaken(true);
                else onFailed();
              });
          }}
          className="btn bg-accent text-on-accent shadow-accent hover:opacity-90 disabled:opacity-50"
        >
          {t("create")}
        </button>
      </div>
    </Overlay>
  );
}
