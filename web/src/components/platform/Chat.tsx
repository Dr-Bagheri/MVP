"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import { useRefreshEpoch } from "@/lib/refreshBus";
import { openChatLive, mergeBySeq, type ChatLiveState } from "@/lib/chatLive";
import { shouldStick } from "@/lib/threadFollow";
import type { ChatChannelRecord, ChatMessageRecord, OrgPersonRecord } from "@/api/types";
import { Overlay } from "./Overlay";
import { Avatar } from "@/components/Avatar";
import { AgentAvatar } from "./AgentAvatar";
import { KebabMenu } from "@/components/rowActions";
import { SkeletonLines } from "@/components/scaffold";
import { IconArchive, IconClose, IconPlus, IconSend } from "@/components/icons";
import { digits, personName } from "@/lib/format";

/**
 * THE TEAM CHANNEL (0184) — user directive, 2026-09-04: "add a chat room
 * section in the menu for all members to join and a place that they can talk
 * to each other … so everyone can be added and chat there even the agents."
 *
 * What is here and why each piece is:
 *
 *   · A CHANNEL LIST with two states and no third. Bold = unread, a numeric
 *     badge = you were named. That is Slack's model and it is two classes on
 *     purpose: a dot beside a bold row is a third state nobody can name.
 *   · GROUPING at five minutes, broken by author, by day, and — the
 *     non-obvious one — by anything that changes the header, so an older
 *     message is never filed under a newer name.
 *   · MENTION HIGHLIGHT that is not colour alone: a tint AND a border AND a
 *     word a screen reader reads.
 *   · `<bdi>` around every name and handle. Not decoration: a Persian name
 *     inside an English row, or a Latin handle at the head of a Persian
 *     sentence, drags the punctuation to the wrong end of the line. The
 *     bubble's own direction follows the CONVERSATION when the text has no
 *     strong character of its own — `dir="auto"` alone returns `ltr` there,
 *     by specification, and that is the message-starts-with-@handle bug that
 *     every chat product has shipped at least once.
 *
 * What is deliberately absent: typing indicators between PEOPLE (highest
 * fan-out, lowest value — the vendor that invented it has stranded the API),
 * read receipts (Slack's own `mark` broadcasts to your own devices only;
 * there is no mechanism by which member B learns member A's position), and
 * threads.
 */

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function Chat({ meId, people }: { meId: string | null; people: OrgPersonRecord[] }) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [channels, setChannels] = useState<ChatChannelRecord[] | null | "failed">(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[] | null>(null);
  const [live, setLive] = useState<ChatLiveState>("off");
  const [typing, setTyping] = useState<string | null>(null);
  const [failedAgent, setFailedAgent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const epoch = useRefreshEpoch("chat");
  const loadChannels = useCallback(() => {
    void api.chatChannels().then(setChannels).catch(() => setChannels("failed"));
  }, []);
  useEffect(loadChannels, [loadChannels, epoch]);

  /* the first channel, once. Not `current ?? channels[0]` at render: that
     would silently move the person to another room the moment a channel is
     archived, which reads as the app losing their place. */
  useEffect(() => {
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
           channel's messages under another's name */
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
    loadMessages(current, "open");
  }, [current, loadMessages]);

  /* ONE stream for the whole org, demultiplexed here. A stream per channel
     would hit the browser's six-connection HTTP/1.1 ceiling with four rooms
     and two tabs open. */
  useEffect(() => openChatLive({
    onState: setLive,
    onPoll: () => { if (currentRef.current !== null) loadMessages(currentRef.current, "catchup"); },
    onEvent: (event) => {
      if (event.type === "message" || event.type === "edited") {
        if (event.message.channel_id !== currentRef.current) {
          /* another room moved — the badge is the channel list's business */
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
     rendering: the unread divider has to stay where it is while somebody
     reads the messages under it. */
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
    try {
      const message = await api.postChatMessage(current, body);
      setMessages((cur) => mergeBySeq(cur ?? [], [message]));
      tip.current = Math.max(tip.current, message.seq);
      stick.current = true;
    } catch {
      setError(t("sendFailed"));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ── the rooms ─────────────────────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex" aria-label={t("channels")}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{t("channels")}</h2>
          <button type="button" onClick={() => setCreating(true)}
            className="btn btn-icon text-fg-muted hover:text-fg" aria-label={t("newChannel")}>
            <IconPlus width={12} height={12} />
          </button>
        </div>
        {channels === null ? (
          <SkeletonLines lines={4} />
        ) : channels === "failed" ? (
          <p className="text-xs text-fg-muted">{t("readFailed")}</p>
        ) : channels.length === 0 ? (
          <p className="text-xs text-fg-subtle">{t("noChannels")}</p>
        ) : (
          <ul className="space-y-0.5">
            {channels.map((room) => {
              const unread = room.last_seq > room.last_read_seq;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    aria-current={room.id === current ? "true" : undefined}
                    onClick={() => setCurrent(room.id)}
                    className={`tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs ${
                      room.id === current ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2"
                    }`}
                  >
                    <span aria-hidden className="text-fg-subtle">#</span>
                    {/* BOLD is the unread state — no dot beside it, because a
                        bold row with a dot is a third state nobody can name */}
                    <bdi className={`min-w-0 flex-1 truncate ${unread ? "font-bold text-fg" : ""}`}>
                      {room.name}
                    </bdi>
                    {room.mention_count > 0 ? (
                      <span className="badge-num shrink-0 rounded-md bg-danger px-1.5 text-[10px] font-bold text-on-accent">
                        {digits(room.mention_count, locale)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* ── the room ──────────────────────────────────────────────────── */}
      <section className="tile flex min-h-0 flex-1 flex-col" aria-label={t("room")}>
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
              act on (their answers arrive within seconds instead of at once),
              and hiding it would make a working fallback look like a fault. */}
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
                  icon: <IconPlus width={12} height={12} />,
                  onSelect: () => {
                    void api.setChatJoined(channel.id, !channel.joined)
                      .then(loadChannels).catch(() => setError(t("writeFailed")));
                  },
                },
                {
                  key: "archive",
                  label: t("archive"),
                  icon: <IconArchive width={12} height={12} />,
                  danger: true,
                  onSelect: () => {
                    void api.updateChatChannel(channel.id, { archived: true })
                      .then(() => { setCurrent(null); loadChannels(); })
                      .catch(() => setError(t("writeFailed")));
                  },
                },
              ]}
            />
          ) : null}
        </header>

        {error !== null ? (
          <p role="alert" className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        <div
          ref={scroller}
          onScroll={(e) => { stick.current = shouldStick(e.currentTarget); }}
          role="log"
          aria-label={t("messages")}
          aria-live="polite"
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-4 py-3"
        >
          {messages === null ? (
            <SkeletonLines lines={5} />
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-fg-subtle">{t("emptyRoom")}</p>
          ) : (
            messages.map((message, i) => (
              <Row
                key={message.id}
                message={message}
                previous={messages[i - 1] ?? null}
                people={people}
                meId={meId}
                locale={locale}
                onEdited={(updated) => setMessages((cur) => mergeBySeq(cur ?? [], [updated]))}
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
          onSend={send}
        />
      </section>

      {creating ? (
        <NewChannelDialog
          onClose={() => setCreating(false)}
          onCreated={(room) => { setCreating(false); setCurrent(room.id); loadChannels(); }}
          onFailed={() => { setCreating(false); setError(t("writeFailed")); }}
        />
      ) : null}
    </div>
  );
}

/** the same five-minute window Element uses, with the break conditions that
    matter more than the number */
function grouped(message: ChatMessageRecord, previous: ChatMessageRecord | null): boolean {
  if (previous === null) return false;
  if (previous.author_kind !== message.author_kind) return false;
  if (previous.author_id !== message.author_id) return false;
  if (previous.agent_handle !== message.agent_handle) return false;
  const gap = new Date(message.created_at).getTime() - new Date(previous.created_at).getTime();
  if (gap > GROUP_WINDOW_MS) return false;
  /* a day change breaks the group even inside five minutes — 23:58 and 00:01
     belong under different headers however close they are */
  return new Date(message.created_at).getDate() === new Date(previous.created_at).getDate();
}

function Row({ message, previous, people, meId, locale, onEdited }: {
  message: ChatMessageRecord;
  previous: ChatMessageRecord | null;
  people: OrgPersonRecord[];
  meId: string | null;
  locale: string;
  onEdited: (message: ChatMessageRecord) => void;
}) {
  const t = useTranslations("chat");
  const person = message.author_id === null
    ? null
    : people.find((p) => p.id === message.author_id) ?? null;
  const name = message.author_kind === "agent"
    ? message.agent_handle ?? "?"
    : person === null ? t("unknownPerson") : personName(person, locale);
  const mine = meId !== null && message.author_id === meId;
  const namedMe = meId !== null && message.mentions.includes(meId);
  const head = !grouped(message, previous);

  return (
    <div
      className={`group -mx-2 rounded-lg px-2 py-0.5 ${head ? "mt-2" : ""} ${
        /* not colour alone: a tint AND a border AND a word */
        namedMe ? "border-s-2 border-accent bg-accent-soft/40" : ""
      }`}
    >
      {namedMe ? <span className="sr-only">{t("youWereMentioned")}</span> : null}
      {head ? (
        <div className="flex items-center gap-2">
          {message.author_kind === "agent"
            ? <AgentAvatar handle={message.agent_handle ?? ""} size="sm" />
            : <Avatar name={name} size="xs" />}
          {/* <bdi>, not a span: a Persian name in an English row and a Latin
              one in a Persian row both drag their neighbours' punctuation to
              the wrong end of the line, and a stylesheet is allowed to be
              ignored where this element is not */}
          <bdi className="text-xs font-semibold text-fg">{name}</bdi>
          {message.author_kind === "agent" ? (
            <span className="badge-num rounded bg-surface-2 px-1 text-[9px] text-fg-subtle">
              {t("agentTag")}
            </span>
          ) : null}
          <time className="badge-num text-[10px] text-fg-subtle" dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString(locale === "fa" ? "fa-IR" : "en-GB",
              { hour: "2-digit", minute: "2-digit" })}
          </time>
          {mine && !message.deleted ? (
            <button
              type="button"
              onClick={() => {
                void api.editChatMessage(message.id, { deleted: true })
                  .then(onEdited).catch(() => undefined);
              }}
              className="tap text-[10px] text-fg-subtle opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            >
              {t("removeMessage")}
            </button>
          ) : null}
        </div>
      ) : null}
      <p
        /* the CONVERSATION's direction is the fallback, never `auto` alone:
           the spec walks past digits and emoji but returns `ltr` for a
           message whose first strong character is Latin — an @handle, a URL,
           "OK" — which is the bug every chat product ships once */
        dir={/[؀-ۿ]/.test(message.body ?? "") ? "rtl" : "auto"}
        className={`ps-7 text-sm leading-6 ${
          message.deleted ? "text-fg-subtle italic" : "text-fg"
        }`}
      >
        {message.deleted ? t("removedMessage") : message.body}
        {message.edited_at !== null && !message.deleted ? (
          <span className="ms-1 text-[10px] text-fg-subtle">{t("edited")}</span>
        ) : null}
      </p>
    </div>
  );
}

function Composer({ disabled, people, onSend }: {
  disabled: boolean;
  people: OrgPersonRecord[];
  onSend: (body: string) => void | Promise<void>;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  /* the handles a `@` is currently reaching for. Agents included: naming one
     is the WHOLE authorization for it to answer, so it has to be as easy to
     type as a colleague's name. */
  const candidates = useMemo(() => {
    if (picking === null) return [];
    const q = picking.toLowerCase();
    const agents = ["echo", "roya", "ava"].map((handle) => ({ handle, label: handle, agent: true }));
    /* only people who HAVE a handle: a mention of a handle nobody holds
       resolves to nobody, so offering it would be a control that silently
       does nothing */
    const humans = people
      .filter((p) => p.username !== null)
      .map((p) => ({ handle: p.username!, label: personName(p, locale), agent: false }));
    return [...agents, ...humans]
      .filter((c) => c.handle.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [picking, people, locale]);

  const onChange = (value: string) => {
    setDraft(value);
    const caret = box.current?.selectionStart ?? value.length;
    const match = /(?:^|\s)@([a-z0-9_-]*)$/i.exec(value.slice(0, caret));
    setPicking(match === null ? null : match[1]!);
  };

  const choose = (handle: string) => {
    setDraft((cur) => cur.replace(/@([a-z0-9_-]*)$/i, `@${handle} `));
    setPicking(null);
    box.current?.focus();
  };

  const submit = () => {
    const body = draft.trim();
    if (body === "" || disabled) return;
    setDraft("");
    setPicking(null);
    void onSend(body);
  };

  return (
    <div className="relative border-t border-border p-3">
      {candidates.length > 0 ? (
        <ul className="absolute bottom-full mb-1 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-island">
          {candidates.map((c) => (
            <li key={c.handle}>
              <button type="button" onClick={() => choose(c.handle)}
                className="tap flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-fg hover:bg-surface-2">
                <bdi className="font-medium">{c.label}</bdi>
                <bdi className="text-fg-subtle">@{c.handle}</bdi>
                {c.agent ? (
                  <span className="ms-auto text-[9px] text-fg-subtle">{t("agentTag")}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={draft}
          disabled={disabled}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            /* `isComposing` is the half most implementations miss: without it
               the Enter that CONFIRMS an IME candidate sends a half-typed
               word, which is a daily annoyance in exactly the languages this
               product is for */
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("composerPlaceholder")}
          /* explicit, because `placeholder` ignores dir="auto" in every
             browser — an open bug, not something to wait out */
          dir={locale === "fa" ? "rtl" : "ltr"}
          className="input max-h-32 min-h-0 flex-1 resize-none py-2"
        />
        <button type="button" onClick={submit} disabled={disabled || draft.trim() === ""}
          className="btn btn-icon bg-accent text-on-accent hover:opacity-90 disabled:opacity-40"
          aria-label={t("send")}>
          <IconSend width={14} height={14} />
        </button>
      </div>
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
