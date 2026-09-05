"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ChatMessageRecord, OrgPersonRecord } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { AgentAvatar } from "../AgentAvatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAsk } from "@/components/icons";
import { digits, personName } from "@/lib/format";
import { MessageBody } from "./MessageBody";

/**
 * ONE MESSAGE (0184, its actions 0189, and 2026-09-05's corrections).
 *
 * ── RIGHT-CLICK IS THE DOOR, AND IT LANDS ON THE MESSAGE ──────────────────
 *
 * Three changes, all from one user report, all about the same thing being in
 * the wrong place:
 *
 *  1. THE MENU OPENED FAR FROM THE POINTER. `at.x` is measured from the row's
 *     LEFT edge (`clientX - box.left`) and was being written to
 *     `inset-inline-start`, which on a Persian page resolves to RIGHT — so
 *     the anchor was mirrored and the panel landed off the far side of the
 *     message. Physical `left`, because the number is physical. The logical
 *     property is the reflex here and it is the bug; it would have looked
 *     perfect in English.
 *
 *  2. THE HOVER BAR IS GONE ("remove the other reply and emoji that comes in
 *     the same row"). It floated over the message's own first line, which is
 *     what made it worth removing: an action strip that covers the words it
 *     acts on costs more than the affordance it buys. The cost is recorded
 *     rather than argued away — `rowActions.tsx` says a right-click menu is
 *     invisible and has no touch equivalent, and that is now true here.
 *
 *  3. DELETE IS GONE FROM THE MENU. It sat one row under «پاسخ», where the
 *     press that meant "answer this" is a few pixels from the press that
 *     removes it. Removing a message is not reachable from the room any more;
 *     the route and the policy stay, so bringing it back is a menu entry.
 *
 * The menu is the SAME Radix menu, anchored to a zero-size element at the
 * pointer — the shape `ContextMenu` used before it was deleted, and the
 * reason it is not a hand-rolled panel (2026-09-02: the portals are the
 * primitive's).
 */

const QUICK = ["👍", "❤️", "😄", "🎉", "🙏", "👀"];

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** the same five-minute window Element uses, with the breaks that matter */
export function grouped(message: ChatMessageRecord, previous: ChatMessageRecord | null): boolean {
  if (previous === null) return false;
  if (previous.author_kind !== message.author_kind) return false;
  if (previous.author_id !== message.author_id) return false;
  if (previous.agent_handle !== message.agent_handle) return false;
  /* A REPLY ALWAYS STARTS ITS OWN GROUP. Folding it under the previous
     message would put the quote in the middle of somebody's paragraph, where
     it reads as part of what they were saying. */
  if (message.reply_to !== null) return false;
  const gap = new Date(message.created_at).getTime() - new Date(previous.created_at).getTime();
  if (gap > GROUP_WINDOW_MS) return false;
  /* a day change breaks the group even inside five minutes — 23:58 and 00:01
     belong under different headers however close they are */
  return new Date(message.created_at).getDate() === new Date(previous.created_at).getDate();
}

export function MessageRow({ message, previous, people, meId, locale, onReply, onReact }: {
  message: ChatMessageRecord;
  previous: ChatMessageRecord | null;
  people: OrgPersonRecord[];
  meId: string | null;
  locale: string;
  onReply: (message: ChatMessageRecord) => void;
  onReact: (message: ChatMessageRecord, emoji: string, on: boolean) => void;
}) {
  const t = useTranslations("chat");
  /* where the right-click landed, in the row's own coordinates. Null = the
     menu is closed; a number pair = open, anchored there. */
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const person = message.author_id === null
    ? null
    : people.find((p) => p.id === message.author_id) ?? null;
  const name = message.author_kind === "agent"
    ? message.agent_handle ?? "?"
    : person === null ? t("unknownPerson") : personName(person, locale);
  const namedMe = meId !== null && message.mentions.includes(meId);
  const head = !grouped(message, previous);

  const nameOf = (authorId: string | null, kind: string, handle: string | null) => {
    if (kind === "agent") return handle ?? "?";
    const p = authorId === null ? null : people.find((x) => x.id === authorId) ?? null;
    return p === null ? t("unknownPerson") : personName(p, locale);
  };

  const items = (
    <>
      <div className="flex items-center gap-0.5 px-1 pb-1">
        {QUICK.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              const on = !(message.reactions.find((r) => r.emoji === emoji)?.mine ?? false);
              onReact(message, emoji, on);
              setAt(null);
            }}
            /* the THEME's icon control, not a fourth invented square: the
               emoji strip is a row of small buttons, which is exactly what
               `.btn btn-icon` was measured for */
            className="btn btn-icon hover:bg-surface-2"
            aria-label={emoji}
          >
            <span className="text-base">{emoji}</span>
          </button>
        ))}
      </div>
      <DropdownMenuItem onSelect={() => onReply(message)}>
        <IconAsk width={12} height={12} />
        {t("reply")}
      </DropdownMenuItem>
    </>
  );

  return (
    <div
      className={`group relative -mx-2 rounded-lg px-2 py-0.5 ${head ? "mt-2" : ""} ${
        /* not colour alone: a tint AND a border AND a word */
        namedMe ? "border-s-2 border-accent bg-accent-soft/40" : ""
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        setAt({ x: e.clientX - box.left, y: e.clientY - box.top });
      }}
    >
      {namedMe ? <span className="sr-only">{t("youWereMentioned")}</span> : null}

      {/* THE QUOTE, above the words it answers */}
      {message.reply_to !== null ? (
        <div className="mb-0.5 ms-7 flex items-center gap-1.5 border-s-2 border-border ps-2 text-[11px] text-fg-subtle">
          <bdi className="font-medium">
            {nameOf(message.reply_to.author_id, message.reply_to.author_kind, message.reply_to.agent_handle)}
          </bdi>
          <span className="min-w-0 flex-1 truncate">
            {message.reply_to.excerpt ?? t("removedMessage")}
          </span>
        </div>
      ) : null}

      {head ? (
        <div className="flex items-center gap-2">
          {message.author_kind === "agent"
            ? <AgentAvatar handle={message.agent_handle ?? ""} size="sm" />
            : <Avatar name={name} size="xs" />}
          {/* <bdi>, not a span: a Persian name in an English row and a Latin
              one in a Persian row both drag their neighbours' punctuation to
              the wrong end of the line */}
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
        </div>
      ) : null}

      <p
        /* THE SCREEN'S direction, never the message's (user, 2026-09-05:
           "in the fa version, in the chat box, all text must come from right
           to left, even English ones"). `auto` — and the Persian-if-any-
           Persian rule before it — let a message that opened with an
           @handle or a Latin word sit on the left of a Persian room, which
           is what the screenshot showed: the person's line on one side, the
           agent's on the other, because one began with a handle. */
        dir={locale === "fa" ? "rtl" : "ltr"}
        className={`ps-7 text-sm leading-6 ${
          message.deleted ? "italic text-fg-subtle" : "text-fg"
        }`}
      >
        {message.deleted
          ? t("removedMessage")
          : <MessageBody body={message.body ?? ""} people={people} locale={locale} />}
        {message.edited_at !== null && !message.deleted ? (
          <span className="ms-1 text-[10px] text-fg-subtle">{t("edited")}</span>
        ) : null}
      </p>

      {/* THE REACTIONS, under the words — the count is the whole point, so it
          is a chip with a number and not a bare glyph */}
      {message.reactions.length > 0 ? (
        <div className="ms-7 mt-1 flex flex-wrap items-center gap-1">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(message, r.emoji, !r.mine)}
              aria-pressed={r.mine}
              className={`tap inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                r.mine
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface-2 text-fg-muted hover:text-fg"
              }`}
            >
              <span>{r.emoji}</span>
              <span className="badge-num">{digits(r.count, locale)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* THE RIGHT-CLICK, the SAME items, anchored where the pointer was.
          A zero-size trigger rather than a hand-rolled panel: the portal, the
          focus trap, the outside-press and the viewport flip are the
          primitive's, and this repo stopped keeping private copies of them
          on 2026-09-02. */}
      <DropdownMenu open={at !== null} onOpenChange={(open) => { if (!open) setAt(null); }}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute h-0 w-0"
            /* PHYSICAL `left`, and that is the fix: `at.x` counts pixels from
               the row's LEFT edge, so writing it to a logical property makes
               the anchor mirror itself on a Persian page and the menu opens
               off the far side of the message. */
            style={at === null ? { display: "none" } : { left: at.x, top: at.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[13rem] p-1">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
  );
}
