"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { AgentEvent, AgentMessage, ModelInfo, Skill, User } from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { personName } from "@/lib/format";
import { ConversationThread } from "./ConversationThread";
import { HistoryPanel } from "./HistoryPanel";
import { EchoMark, MicIcon, PlusIcon, SendIcon, ToolsIcon } from "./icons";

/**
 * The AI-assistant hub — NeurAI's first page (M22, user-approved).
 *
 * **The conversation is a STATE of this surface, not a redesign of it**
 * (steward ruling). Four states now, one screen: idle (the approved anatomy),
 * active (thread center, prompt at foot), resumed (a stored thread through
 * the SAME component as a live one), and history (the conversation list as
 * an overlay state, per the M22 amendment — never permanent chrome).
 *
 * ---
 *
 * **`session` capture is the load-bearing part of this file.** On a
 * sessionless ask the server creates a conversation and announces it in a
 * `session` event sent before any delta — on `created: true` that event is
 * the ONLY place the id will ever appear. A client that drops it starts a
 * brand-new conversation on every message while looking like it remembers.
 *
 * The wire's other rules, kept: unknown event types are ignored by contract;
 * `done` means the turn is persisted (a refetch after done always finds it);
 * a failed run leaves the question standing, nothing invented beside it.
 *
 * **After `done` the thread is REFETCHED** (M27): the streamed reply lived
 * under a local id the server never heard of, and every toolbar action
 * (feedback, regenerate) needs the persisted id. Onyx refetches for the same
 * reason; adopting the server's rows is what makes the toolbar honest.
 */
export function Hub() {
  const t = useTranslations("platform");
  const locale = useLocale();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [model, setModel] = useState<string>("");
  const [skill, setSkill] = useState<string>("");
  /** Held in a ref, not state: it is read inside the stream loop, where a
   *  stale closure over state would silently start a second conversation. */
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  /**
   * Resume is driven by a URL param (`?c=<id>`), not component state: Back
   * leaves a conversation, reload returns to it, a thread can be linked.
   */
  const params = useSearchParams();
  const resumeId = params.get("c");

  useEffect(() => {
    void api.me().then(setMe);
    void api.models().then((res) => {
      setModels(res.models);
      // the person's saved choice is the default; "" = let the server say
      setModel(res.preferred_model ?? "");
    });
    void api.skills().then(setSkills);
  }, []);

  const adoptThread = useCallback(async (id: string) => {
    const [thread, verdicts] = await Promise.all([
      api.agentMessages(id),
      api.sessionFeedback(id).catch(() => ({}) as Record<string, string>),
    ]);
    setMessages(thread);
    setFeedback(verdicts);
    sessionId.current = id;
    void api.shareState(id).then(setShared).catch(() => setShared(false));
  }, []);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    void adoptThread(resumeId).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [resumeId, adoptThread]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /**
   * Draft autosave, per conversation (Onyx's composer habit): a half-typed
   * question survives a tab close. sessionStorage, not the server — a draft
   * is a device fact, and the reload-gap rule cuts the other way for text
   * nobody submitted.
   */
  useEffect(() => {
    const key = `neurai-draft-${resumeId ?? "new"}`;
    const saved = sessionStorage.getItem(key);
    if (saved) setInput(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per conversation
  }, [resumeId]);
  useEffect(() => {
    const key = `neurai-draft-${resumeId ?? "new"}`;
    if (input) sessionStorage.setItem(key, input);
    else sessionStorage.removeItem(key);
  }, [input, resumeId]);

  const idle = messages.length === 0 && !showHistory;

  /** One reducer for ask and regenerate — same events, same thread. */
  async function consume(stream: AsyncGenerator<AgentEvent>, replyId: string) {
    for await (const event of stream) {
      switch (event.type) {
        case "session":
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
              /* a failed run with nothing said is no turn at all — the
                 question stands, which is what the server persisted */
              .filter((m) => !(m.id === replyId && event.failed && m.content === "")),
          );
          break;
        // no default: unknown event types are ignorable by contract
      }
    }
  }

  async function run(start: (signal: AbortSignal) => AsyncGenerator<AgentEvent>, replyId: string) {
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await consume(start(controller.signal), replyId);
      // adopt the persisted rows — the toolbar needs server ids
      if (sessionId.current) await adoptThread(sessionId.current);
    } catch (cause) {
      if ((cause as Error).name === "AbortError") {
        /*
         * The STOP button. What remains on screen is what was said before
         * the abort; the server's Shape-A/B rules decide what persists, and
         * the next adoptThread shows exactly that. Settle the local flag so
         * the caret stops blinking on a message nobody is writing.
         */
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)),
        );
        if (sessionId.current) await adoptThread(sessionId.current).catch(() => undefined);
      } else {
        setMessages((prev) => prev.filter((m) => !(m.id === replyId && m.content === "")));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  async function send() {
    const question = input.trim();
    if (question === "" || streaming) return;
    setInput("");
    setShowHistory(false);

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

    await run(
      (signal) =>
        api.ask(question, { page: "hub", callIds: [] }, sessionId.current, {
          model: model || undefined,
          skill: skill || undefined,
          signal,
        }),
      replyId,
    );
  }

  async function regenerate() {
    if (!sessionId.current || streaming) return;
    const replyId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: replyId, role: "assistant", content: "", tool_calls: [], proposal: null, streaming: true },
    ]);
    await run(
      (signal) => api.regenerate(sessionId.current!, { model: model || undefined, signal }),
      replyId,
    );
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function judge(messageId: string, verdict: "up" | "down") {
    // optimistic — the row is the caller's own and the upsert cannot conflict
    setFeedback((prev) => ({ ...prev, [messageId]: verdict }));
    await api.messageFeedback(messageId, verdict).catch(() => {
      setFeedback((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    });
  }

  async function toggleShare() {
    if (!sessionId.current) return;
    setShared(await api.setShared(sessionId.current, !shared));
  }

  /** The visible thread as Markdown — a file the reader can keep. */
  function exportMarkdown() {
    const lines = messages
      .filter((m) => m.content)
      .map((m) => (m.role === "user" ? `**${t("exportYou")}:** ${m.content}` : m.content));
    const blob = new Blob([lines.join("\n\n---\n\n") + "\n"], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "conversation.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function openConversation(id: string) {
    setShowHistory(false);
    router.push({ pathname: "/", query: { c: id } });
  }

  function newConversation() {
    sessionId.current = undefined;
    setMessages([]);
    setFeedback({});
    setShared(false);
    setShowHistory(false);
    router.push("/");
  }

  const headerBtn =
    "tap flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg";

  return (
    <div
      className={`mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 ${
        idle ? "items-center justify-center py-10 text-center" : "py-6"
      }`}
    >
      {/* the conversation controls — visible whenever we are not idle */}
      {!idle ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" className={headerBtn} onClick={() => setShowHistory((v) => !v)}>
            {t("history")}
          </button>
          <button type="button" className={headerBtn} onClick={newConversation}>
            {t("newConversation")}
          </button>
          {messages.length > 0 && sessionId.current ? (
            <>
              <button
                type="button"
                className={shared ? `${headerBtn} border-accent text-accent` : headerBtn}
                aria-pressed={shared}
                onClick={() => void toggleShare()}
              >
                {shared ? t("sharedWithOrg") : t("share")}
              </button>
              <button type="button" className={headerBtn} onClick={exportMarkdown}>
                {t("exportMd")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showHistory ? (
        <div className={idle ? "w-full" : "mb-4"}>
          <HistoryPanel
            activeId={sessionId.current}
            onOpen={openConversation}
            onClose={() => setShowHistory(false)}
          />
        </div>
      ) : null}

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
          {/* the active skill's starter questions (M29) — one press fills
              the composer; sending stays the person's act */}
          {(() => {
            const active = skills.find((s) => s.slug === skill);
            return active && active.starter_questions.length > 0 ? (
              <div className="mt-4 flex w-full max-w-[660px] flex-wrap justify-center gap-2">
                {active.starter_questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="chip border border-border bg-surface text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                    onClick={() => setInput(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null;
          })()}
        </>
      ) : !showHistory ? (
        <div className="mb-4 flex-1">
          <ConversationThread
            messages={messages}
            streaming={streaming}
            feedback={feedback}
            onFeedback={(id, verdict) => void judge(id, verdict)}
            onRegenerate={() => void regenerate()}
          />
          <div ref={threadEnd} />
        </div>
      ) : null}

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
              if (e.key === "Escape" && streaming) stop();
            }}
          />
          <button
            type="button"
            className="tap grid h-[38px] w-[38px] place-items-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg"
            title={t("voice")}
          >
            <MicIcon width={18} height={18} />
          </button>
          {streaming ? (
            /* send morphs into STOP — one button, one place, per the donor's
               composer; Esc does the same from the keyboard */
            <button
              type="button"
              className="tap grid h-[38px] w-[38px] place-items-center rounded-xl bg-surface-2 text-fg"
              title={t("stop")}
              onClick={stop}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
          ) : (
            <button
              type="button"
              className="tap grid h-[38px] w-[38px] place-items-center rounded-xl bg-accent text-on-accent disabled:opacity-50"
              title={t("send")}
              disabled={input.trim() === ""}
              onClick={() => void send()}
            >
              <SendIcon width={18} height={18} />
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {idle ? (
            <button type="button" className={headerBtn} onClick={() => setShowHistory(true)}>
              {t("history")}
            </button>
          ) : null}
          <button type="button" className={headerBtn}>
            <PlusIcon width={14} height={14} />
            {t("addFile")}
          </button>
          <button type="button" className={headerBtn}>
            <ToolsIcon width={14} height={14} />
            {t("tools")}
          </button>
          <span className="flex-1" />
          {/*
            The model choice (M5 precedence: skill pin → this explicit choice
            → the saved preference; no product default underneath). "" =
            "let the server resolve", rendered as the saved-choice line.
          */}
          {skills.length > 0 ? (
            <label className="flex items-center gap-1">
              <span className="sr-only">{t("skillPicker")}</span>
              <select
                className="h-8 max-w-[10rem] rounded-full border border-border bg-transparent px-2 text-xs text-fg-muted outline-none hover:border-border-strong"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
              >
                <option value="">{t("skillDefault")}</option>
                {/* value = SLUG: core's resolver takes /slug, not an id —
                    an id here would 400 as "unknown skill" on every ask */}
                {skills.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {models.length > 0 ? (
            <label className="flex items-center gap-1">
              <span className="sr-only">{t("modelPicker")}</span>
              <select
                className="h-8 max-w-[11rem] rounded-full border border-border bg-transparent px-2 text-xs text-fg-muted outline-none hover:border-border-strong"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
