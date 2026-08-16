"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentMessage, User } from "@/api/types";
import { Link } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { personName } from "@/lib/format";
import { ConversationThread } from "./ConversationThread";
import { EchoMark, MicIcon, PlusIcon, SendIcon, ToolsIcon } from "./icons";

/**
 * The AI-assistant hub — NeurAI's first page (M22, user-approved).
 *
 * **The conversation is a STATE of this surface, not a redesign of it**
 * (steward ruling). Three states, one screen:
 *
 *   - **idle** — the approved anatomy exactly: mark, greeting, the scope
 *     promise, prompt box, app cards. This is what a user meets on arrival.
 *   - **active** — the thread takes the centre and the prompt moves to the
 *     foot. The mark and app cards step aside rather than being pushed down a
 *     scrolling page.
 *   - **resumed** — a stored thread rendered through the SAME component as a
 *     live one; two renderers for one conversation is the drift shape, and the
 *     resumed half is the one nobody looks at.
 *
 * A permanent session sidebar was the alternative and was declined: it would
 * alter the first screen the user signed off, and it renders empty for every
 * new org — chrome that costs a first impression to earn nothing. Reversible if
 * the user ever wants it: same components, different frame.
 *
 * ---
 *
 * **`session` capture is the load-bearing part of this file.** On a sessionless
 * ask the server creates a conversation and announces it in a `session` event
 * sent before any delta — and on `created: true` that event is the ONLY place
 * the id will ever appear. A client that drops it starts a brand-new
 * conversation on every message **while looking like it remembers**: the answer
 * still renders perfectly, the thread still scrolls, and nothing on screen
 * indicates that yesterday's context is gone. That is why the id is captured
 * into a ref before the first delta is handled, not derived afterwards.
 *
 * The three other decisions the wire dictates:
 *   - **Unknown event types are ignored**, by contract. The switch has no
 *     `default` that throws; a future event must not break an older client.
 *   - **`done` means the turn is already persisted** (core/ writes before it
 *     emits), so a refetch after `done` always finds the message. Built to that
 *     guarantee rather than defensively polling.
 *   - **A failed run leaves the question standing.** The empty assistant
 *     placeholder is removed rather than filled with an apology — the thread
 *     records what was said, and a fabricated bubble would be indistinguishable
 *     from a real answer a week later.
 */
export function Hub() {
  const t = useTranslations("platform");
  const locale = useLocale();
  const [me, setMe] = useState<User | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  /** Held in a ref, not state: it is read inside the stream loop, where a
   *  stale closure over state would silently start a second conversation. */
  const sessionId = useRef<string | undefined>(undefined);
  const threadEnd = useRef<HTMLDivElement>(null);

  /**
   * Resume is driven by a URL param (`?c=<id>`), not component state.
   *
   * Three things fall out of that and none of them work with local state: the
   * browser Back button leaves a conversation, a reload returns to the same
   * one, and a thread can be linked to. A conversation the user can reach but
   * not return to is a worse memory than none.
   */
  const params = useSearchParams();
  const resumeId = params.get("c");

  useEffect(() => {
    void api.me().then(setMe);
  }, []);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    void api.agentMessages(resumeId).then((thread) => {
      if (cancelled) return;
      /*
       * The resumed thread renders through the SAME component as a live one.
       * Two renderers for one conversation is the drift shape, and the resumed
       * half is the one nobody looks at — including, notably, the failed-run
       * thread that ends in an unanswered question.
       */
      setMessages(thread);
      sessionId.current = resumeId;
    });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const idle = messages.length === 0;

  async function send() {
    const question = input.trim();
    if (question === "" || streaming) return;
    setInput("");
    setStreaming(true);

    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question,
      tool_calls: [],
      proposal: null,
    };
    const replyId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: replyId, role: "assistant", content: "", tool_calls: [], proposal: null, streaming: true },
    ]);

    try {
      for await (const event of api.ask(question, { page: "hub", callIds: [] }, sessionId.current)) {
        switch (event.type) {
          case "session":
            // captured before anything else can need it
            sessionId.current = event.id;
            break;
          case "text_delta":
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, content: m.content + event.delta } : m)),
            );
            break;
          case "tool_call":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId
                  ? {
                      ...m,
                      tool_calls: [
                        ...m.tool_calls.filter((c) => c.id !== event.id),
                        { id: event.id, name: event.name, label: event.label, state: event.state, ms: event.ms },
                      ],
                    }
                  : m,
              ),
            );
            break;
          case "done":
            setMessages((prev) =>
              prev
                .map((m) =>
                  m.id === replyId
                    ? { ...m, streaming: false, run_id: event.runId, failed: event.failed }
                    : m,
                )
                /*
                 * A failed run with nothing said is not an empty assistant
                 * turn — it is no turn at all. Dropping the placeholder leaves
                 * the question standing, which is what the server persisted and
                 * therefore what a reload will show.
                 */
                .filter((m) => !(m.id === replyId && event.failed && m.content === "")),
            );
            break;
          // no default: unknown event types are ignorable by contract
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div
      className={`mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 ${
        idle ? "items-center justify-center py-10 text-center" : "py-6"
      }`}
    >
      {idle ? (
        <>
          <Image
            src="/brand/neurai-mark.png"
            alt="NeurAI"
            width={76}
            height={76}
            priority
            className="neurai-glow mb-5 h-[56px] w-[56px] md:h-[76px] md:w-[76px]"
          />
          <p className="min-h-[1.25rem] text-sm text-fg-muted">
            {me ? t("greeting", { name: personName(me, locale) }) : ""}
          </p>
          <h1 className="mt-1.5 text-[25px] font-bold leading-snug tracking-tight text-fg md:text-[34px]">
            {t("ask")}
          </h1>
          {/* wide enough for the EN sentence in ONE line (55ch); if a longer
              translation ever wraps, text-wrap:balance splits it evenly
              instead of orphaning the last word */}
          <p className="mt-2.5 max-w-[60ch] text-[13px] leading-6 text-fg-muted [text-wrap:balance]">
            {t("scopePromise")}
          </p>
        </>
      ) : (
        <div className="mb-4 flex-1">
          <ConversationThread messages={messages} streaming={streaming} />
          <div ref={threadEnd} />
        </div>
      )}

      <div
        className={`w-full max-w-[660px] rounded-2xl border border-border-strong bg-surface p-3 text-start ${
          idle ? "mt-7" : "sticky bottom-0 mx-auto"
        }`}
      >
        <div className="flex items-center gap-2">
          <input
            className="min-h-[38px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
            placeholder={t("promptPlaceholder")}
            aria-label={t("promptPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="tap grid h-[38px] w-[38px] place-items-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg"
            title={t("voice")}
          >
            <MicIcon width={18} height={18} />
          </button>
          <button
            type="button"
            className="tap grid h-[38px] w-[38px] place-items-center rounded-xl bg-accent text-on-accent disabled:opacity-50"
            title={t("send")}
            disabled={streaming || input.trim() === ""}
            onClick={() => void send()}
          >
            <SendIcon width={18} height={18} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="tap flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <PlusIcon width={14} height={14} />
            {t("addFile")}
          </button>
          <button
            type="button"
            className="tap flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <ToolsIcon width={14} height={14} />
            {t("tools")}
          </button>
        </div>
      </div>

      {idle ? (
        <div className="mt-7 grid w-full max-w-[660px] grid-cols-[repeat(auto-fill,minmax(226px,1fr))] gap-3">
          <Link
            href="/echo"
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 text-start transition-colors hover:border-border-strong"
          >
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-surface-2">
              <EchoMark size={28} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">{t("echo")}</span>
              <span className="block text-xs text-fg-muted">{t("echoDesc")}</span>
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
