"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { AgentEvent, AgentMessage, ModelInfo, Skill, User } from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { personName, modelLabel } from "@/lib/format";
import { useDictation } from "@/lib/dictation";
import { useSkillName } from "@/lib/skillName";
import { ConversationThread } from "./ConversationThread";
import { EchoMark, HistoryIcon, MicIcon, PlusIcon, SendIcon, ToolsIcon } from "./icons";

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
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [model, setModel] = useState<string>("");
  const [skill, setSkill] = useState<string>("");
  /** The SERVER's refusal sentence, when an ask never opened a stream. */
  const [askError, setAskError] = useState<string | null>(null);
  /**
   * Attached files (user directive: "add files and ask about them"). Text
   * files only, read CLIENT-side and sent as part of the question — the ask
   * wire is text, so this needs no new backend and the record shows exactly
   * what the model saw. Binary and oversized files are refused with a
   * sentence, never silently dropped.
   */
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The mic dictates into the composer (it is NOT Echo's recorder). */
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", (text) =>
    setInput((v) => (v.trim() === "" ? text : `${v} ${text}`)),
  );
  /* system skills localize (shipped product content); authored names never do */
  const skillName = useSkillName();
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
      /*
       * The state ADOPTS what the select will render. `?? ""` here caused
       * the live failure this line replaces: with no saved preference the
       * state held "" while the <select> displayed its first option — the
       * screen showed Gemini, the wire carried no model, and the server
       * refused with "no model selected" against a picker that looked
       * chosen (the silent-substitution select bug, FE3's class). M5 still
       * holds: the product imposes nothing — the ORG's curated list is what
       * the picker offers, and the state now simply tells the truth about
       * which of them is on screen.
       */
      setModel(res.preferred_model ?? res.models[0]?.id ?? "");
    });
    void api.skills().then(setSkills);
    void api.assistantTools().then(setToolNames).catch(() => setToolNames([]));
  }, []);

  const ATTACH_MAX_BYTES = 50_000;
  const ATTACH_MAX_COUNT = 3;

  async function attach(file: File) {
    setAskError(null);
    if (attachments.length >= ATTACH_MAX_COUNT) {
      setAskError(t("fileTooMany"));
      return;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      setAskError(t("fileTooBig", { name: file.name }));
      return;
    }
    const text = await file.text();
    if (text.includes("\u0000")) {
      // a NUL byte is the honest binary test — an audio file belongs in
      // Echo's uploader, and pretending to read it would feed the model noise
      setAskError(t("fileNotText", { name: file.name }));
      return;
    }
    setAttachments((prev) => [...prev, { name: file.name, text }]);
  }

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

  const idle = messages.length === 0;

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
        /*
         * The refusal's own sentence, rendered — the previous version knew
         * only "the run did not finish" and swallowed WHY, which left the
         * user staring at an unanswered question with no lever to pull.
         * The server names the problem ("no model selected…"); saying it
         * is the difference between a bug report and a fixed dropdown.
         */
        setAskError(
          cause instanceof BffError && cause.detail ? cause.detail : t("askFailed"),
        );
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  async function send() {
    const typed = input.trim();
    if (typed === "" || streaming) return;
    setInput("");
    setAskError(null);

    /*
     * Attachments travel INSIDE the question — the ask wire is text, and
     * the persisted record then shows exactly what the model was given
     * (the thread refetch renders it, deliberately: an invisible context
     * would be a prompt the record can't explain).
     */
    const question =
      attachments.length === 0
        ? typed
        : attachments
            .map((a) => `[${t("attachmentTag")}: ${a.name}]\n${a.text}`)
            .join("\n\n") + `\n\n${typed}`;
    setAttachments([]);

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

  function newConversation() {
    sessionId.current = undefined;
    setMessages([]);
    setFeedback({});
    setShared(false);
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
          <Link href="/conversations" className={headerBtn}>
            {t("conversations")}
          </Link>
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
      ) : (
        <div className="mb-4 flex-1">
          <ConversationThread
            messages={messages}
            streaming={streaming}
            feedback={feedback}
            onFeedback={(id, verdict) => void judge(id, verdict)}
            onRegenerate={() => void regenerate()}
          />
          {askError ? (
            <p role="alert" className="mt-2 text-xs leading-6 text-danger">
              {askError}
            </p>
          ) : null}
          <div ref={threadEnd} />
        </div>
      )}

      <div
        /* focus-within: the PANEL is the control, so the panel carries the
           focus affordance — the global :focus-visible ring on the inner
           input drew a box inside a box (the user's report) */
        className={`w-full max-w-[660px] rounded-2xl border border-border-strong bg-surface p-3 text-start transition-colors focus-within:border-accent ${
          idle ? "mt-7" : "sticky bottom-0 mx-auto"
        }`}
      >
        <div className="flex items-center gap-2">
          <input
            className="min-h-[38px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted focus-visible:ring-0 focus-visible:ring-offset-0"
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
            className={`tap grid h-[38px] w-[38px] place-items-center rounded-xl ${
              dictation.status === "listening"
                ? "animate-pulse bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
            title={dictation.status === "listening" ? t("voiceListening") : t("voice")}
            aria-pressed={dictation.status === "listening"}
            onClick={dictation.toggle}
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
        {dictation.status === "unsupported" || dictation.status === "denied" ? (
          /* two different nothings: "this browser can't" vs "you said no" */
          <p className="mt-2 text-xs leading-5 text-fg-muted">
            {dictation.status === "unsupported" ? t("voiceUnsupported") : t("voiceDenied")}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span key={a.name} className="chip bg-surface-2 text-xs text-fg">
                <span className="ltr">{a.name}</span>
                <button
                  type="button"
                  aria-label={t("removeAttachment", { name: a.name })}
                  className="ms-1 text-fg-muted hover:text-fg"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((x) => x.name !== a.name))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.csv,.json,.log,.tsv,text/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void attach(file);
            }}
          />
          <button type="button" className={headerBtn} onClick={() => fileRef.current?.click()}>
            <PlusIcon width={14} height={14} />
            {t("addFile")}
          </button>
          <div
            className="relative"
            /* hover-driven (user directive): the list appears while the
               mouse is over the button or the panel, and leaves with it.
               Click still toggles, which is what a touch screen has. */
            onMouseEnter={() => setToolsOpen(true)}
            onMouseLeave={() => setToolsOpen(false)}
          >
            <button
              type="button"
              className={headerBtn}
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((v) => !v)}
            >
              <ToolsIcon width={14} height={14} />
              {t("tools")}
            </button>
            {toolsOpen ? (
              /* the assistant's REAL reach, from the server's own registry —
                 facts about what a question can trigger, not switches */
              <div className="absolute bottom-10 z-30 w-72 rounded-xl border border-border bg-surface p-3 text-start shadow-lg">
                <p className="mb-2 text-xs font-semibold text-fg">{t("toolsTitle")}</p>
                <ul className="space-y-1.5">
                  {toolNames.map((name) => (
                    <li key={name} className="text-xs leading-5">
                      <span className="ltr font-mono text-fg">{name}</span>
                      <span className="block text-fg-muted">{t(`tool_${name}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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
                className="select-pill max-w-[10rem]"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
              >
                <option value="">{t("skillDefault")}</option>
                {/* value = SLUG: core's resolver takes /slug, not an id —
                    an id here would 400 as "unknown skill" on every ask */}
                {skills.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {skillName(s)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {models.length > 0 ? (
            <label className="flex items-center gap-1">
              <span className="sr-only">{t("modelPicker")}</span>
              <select
                className="select-pill max-w-[11rem]"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelLabel(m.name)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {/* Conversations sits BELOW the chat box (user directive, round 2):
          the inline history panel is retired — the button goes to the real
          surface, and the top bar no longer carries a twin. */}
      {idle ? (
        <div className="mt-3 flex w-full max-w-[660px] justify-start">
          <Link href="/conversations" className={headerBtn}>
            <HistoryIcon width={14} height={14} />
            {t("conversations")}
          </Link>
        </div>
      ) : null}

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
