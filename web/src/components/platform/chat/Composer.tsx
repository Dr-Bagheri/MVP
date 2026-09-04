"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ChatMessageRecord, OrgPersonRecord } from "@/api/types";
import { micTone, useDictation } from "@/lib/dictation";
import { usePushToTalk } from "@/lib/usePushToTalk";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAt, IconClose, IconEnter, IconMic, IconSmile } from "@/components/icons";
import { personName } from "@/lib/format";
import { AGENT_HANDLES } from "./MessageBody";

/**
 * THE ROOM'S COMPOSER (0189) — user directive, 2026-09-04, describing Buzz:
 * "the text box can contain two lines of text, and on the right side, lowest
 * part, an enter icon without fill for sending; and on the other side, left,
 * there must be a @ option … and a mic option like the AI assistant with the
 * same hotkey, and an emoji dropdown."
 *
 * ── THE SIDES ARE PHYSICAL, AND THAT IS THE INSTRUCTION ───────────────────
 *
 * `dir="ltr"` on the control row, so "right" means right on a Persian screen
 * too. The logical forms would be the usual answer and they are wrong here:
 * the person was LOOKING AT THE RTL PAGE when they said which corner each
 * control belongs in, and mirroring that instruction to be tidy would move
 * both buttons to the other side of the box they just pointed at. Same
 * reasoning as the sign-in password eye, and the same test: a logical form
 * here would look right in English.
 *
 * The TEXT keeps the page's direction. Only the row of buttons is pinned.
 *
 * ── TWO LINES ─────────────────────────────────────────────────────────────
 *
 * `rows={2}` and it does not grow. The box is fixed on purpose — a composer
 * that grows pushes the conversation up while somebody is reading it, and the
 * room above it is already a fixed height for the same reason. Past two lines
 * the textarea scrolls itself.
 */

const EMOJI = [
  "😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😐",
  "👍", "👎", "👏", "🙏", "💪", "🔥", "✅", "❌",
  "❤️", "🎉", "🚀", "⭐", "💡", "📌", "⏰", "☕",
];

export function Composer({ disabled, people, replyTo, onCancelReply, onSend }: {
  disabled: boolean;
  people: OrgPersonRecord[];
  /** the message being answered, quoted above the box until it is sent */
  replyTo: ChatMessageRecord | null;
  onCancelReply: () => void;
  onSend: (body: string) => void | Promise<void>;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  /* THE SAME MIC AS THE ASSISTANT — the same hook and the same hotkey, not a
     second dictation. A room with its own voice implementation is two places
     for "the mic stopped working" to be true. */
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", (text) => {
    setDraft((v) => (v.trim() === "" ? text : `${v} ${text}`));
    /* the caret follows the words: dictating into a box without touching
       focus sends the next Enter to the document body */
    box.current?.focus();
  });
  usePushToTalk({
    onPress: () => { if (dictation.status !== "listening") dictation.toggle(); },
    onRelease: () => { if (dictation.status === "listening") dictation.toggle(); },
  });

  /** who a `@` is currently reaching for — agents first, because naming one
      is the whole authorization for it to answer */
  const candidates = useMemo(() => {
    if (picking === null) return [];
    const q = picking.toLowerCase();
    const agents = AGENT_HANDLES.map((handle) => ({ handle, label: handle, agent: true }));
    const humans = people
      .filter((p) => p.username !== null)
      .map((p) => ({ handle: p.username!, label: personName(p, locale), agent: false }));
    return [...agents, ...humans]
      .filter((c) => c.handle.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [picking, people, locale]);

  /**
   * ANSWERING AN AGENT NAMES IT (user directive, 2026-09-05: "if you reply on
   * agent's message it must add @ automatically").
   *
   * Written into the DRAFT rather than bolted on at send: the person sees the
   * handle they are about to send, can delete it, and gets exactly the
   * message they read before pressing Enter. A silent prefix added on the way
   * out would summon somebody with a word the sender never saw.
   *
   * The server does not depend on this. It reads the reply target off the
   * stored row and treats answering an agent as naming it there too, so the
   * agent answers even when this handle has been deleted — which is the point
   * of the directive's other half ("it does not always need to put @
   * yourself"). This is the visible half of one rule, not the rule.
   */
  const quoted = replyTo?.id ?? null;
  useEffect(() => {
    /* ONE check, on the HANDLE. `author_kind === "agent"` was here beside it
       and was a second spelling of the same fact: 0184's own
       `chat_message_author_shape` makes `agent_handle` non-null exactly when
       the author is an agent, so the two could never disagree — and the
       verify-red proved it, staying green when the kind check was deleted
       because the handle check was already doing all the work. A guard that
       cannot fail is a guard the next reader trusts. */
    const handle = replyTo?.agent_handle ?? null;
    if (handle === null || handle === "") return;
    setDraft((cur) => (new RegExp(`(?:^|\s)@${handle}\b`, "i").test(cur)
      ? cur
      : `@${handle} ${cur.trimStart()}`));
    box.current?.focus();
    /* on the TARGET's id, not on the object: the parent rebuilds `replyTo`
       on every message that arrives, and a dependency on the object would
       prepend the handle again with each one */
  }, [quoted, replyTo]);

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

  const insert = (text: string) => {
    setDraft((cur) => (cur === "" || cur.endsWith(" ") ? cur + text : `${cur} ${text}`));
    box.current?.focus();
  };

  /**
   * The `@` BUTTON OPENS THE PICKER, which is the whole reason it exists.
   *
   * It used to call `insert("@")` and stop there — and `insert` changes the
   * draft without going through `onChange`, so `picking` stayed null and
   * nothing appeared until the person typed a letter. A dedicated control
   * that does nothing visible when pressed is worse than no control: it
   * teaches that the feature is broken, on the press that was meant to
   * introduce it. Empty string, not null: `startsWith("")` matches every
   * handle, so the list opens showing the agents first.
   */
  const openMentions = () => {
    insert("@");
    setPicking("");
  };

  const submit = () => {
    const body = draft.trim();
    if (body === "" || disabled) return;
    setDraft("");
    setPicking(null);
    void onSend(body);
  };

  const tool = "btn btn-icon text-fg-subtle hover:text-fg";

  return (
    <div className="relative border-t border-border p-2.5">
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

      {replyTo !== null ? (
        /* THE QUOTE STAYS UNTIL IT IS SENT OR CANCELLED. A reply target held
           only in state, with nothing on screen, is a message that answers
           something for reasons only the sender knows. */
        <div className="mb-1.5 flex items-center gap-2 rounded-lg border-s-2 border-accent bg-surface-2 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
            {t("replyingTo")}: {replyTo.body ?? t("removedMessage")}
          </span>
          <button type="button" onClick={onCancelReply}
            className="btn btn-icon text-fg-subtle hover:text-fg" aria-label={t("cancelReply")}>
            <IconClose width={12} height={12} />
          </button>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-field focus-within:border-accent">
        <textarea
          ref={box}
          value={draft}
          disabled={disabled}
          rows={2}
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
          className="max-h-24 w-full resize-none bg-transparent px-3 pt-2 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />

        {/* PHYSICAL sides — see the header. Tools first, send last, under
            dir="ltr", so the row reads left-to-right whatever the page does. */}
        <div dir="ltr" className="flex items-center justify-between px-1.5 pb-1.5">
          <div className="flex items-center gap-0.5">
            <button type="button" disabled={disabled} onClick={openMentions}
              className={tool} aria-label={t("mention")} title={t("mention")}>
              <IconAt width={14} height={14} />
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => dictation.toggle()}
              aria-pressed={dictation.status === "listening"}
              /* NOT `tool`: that base sets its own colour, and this button's
                 whole job is to change colour. `micTone` carries the ground
                 and the ink together for exactly that reason — the version
                 that appended a colour to `tool` is the one a person reported
                 as "the mic does not show when it is active". */
              className={`btn btn-icon ${micTone(dictation.status)}`}
              aria-label={t("dictate")}
              title={t("dictate")}
            >
              <IconMic width={14} height={14} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={disabled} className={tool}
                  aria-label={t("emoji")} title={t("emoji")}>
                  <IconSmile width={14} height={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 p-2">
                {/* eight across at the theme's icon size — the panel is
                   widened to fit them rather than the buttons shrunk to fit
                   the panel, because a fifth square size is how a product
                   comes to look like several people built it */}
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJI.map((e) => (
                    <button key={e} type="button" onClick={() => insert(e)}
                      className="btn btn-icon text-base hover:bg-surface-2">
                      {e}
                    </button>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* WITHOUT FILL, as asked: an outline glyph, not a filled pill. The
              send affordance in a room is pressed by Enter almost every time,
              so a solid accent button would be the loudest thing on a screen
              whose subject is the conversation. */}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || draft.trim() === ""}
            className="btn btn-icon border border-border text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40"
            aria-label={t("send")}
            title={t("send")}
          >
            <IconEnter width={14} height={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
