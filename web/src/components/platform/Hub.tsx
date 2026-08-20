"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { AgentCard, AgentEvent, AgentMessage, ConnectorProvider, ModelInfo, SearchHit, Skill, User } from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { personName, modelLabel } from "@/lib/format";
import { useDictation } from "@/lib/dictation";
import { deliverDoc } from "@/lib/deliver";
import { useSkillName, useSkillStarters } from "@/lib/skillName";
import { ConversationThread } from "./ConversationThread";
import { useAssistantConversation } from "./AssistantConversationState";
import { DocumentIcon, EchoMark, MicIcon, PlusIcon, SendIcon, ToolsIcon } from "./icons";

type CreateKind = "doc" | "pdf";

const TOOL_COMMAND_KEYS: Readonly<Record<string, string>> = {
  search_transcripts: "toolCommandSearchTranscripts",
  read_window: "toolCommandReadWindow",
  get_call: "toolCommandGetCall",
  list_related_calls: "toolCommandListRelatedCalls",
  correct_transcript: "toolCommandCorrectTranscript",
  edit_speaker_roster: "toolCommandEditSpeakerRoster",
  replace_summary: "toolCommandReplaceSummary",
};

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
  const { resetVersion, setStarted } = useAssistantConversation();
  const [me, setMe] = useState<User | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentCard[]>([]);
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
  /**
   * The Create and Sources menus (user directive, 2026-08-18, from the
   * reference hub): every entry is a REAL destination or a real act — the
   * no-dead-buttons law binds a menu item exactly as it binds a button.
   */
  const [createOpen, setCreateOpen] = useState(false);
  /** A document format is a visible, removable part of the request — never
   * hidden text placed into the editor on the person's behalf. */
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  /**
   * Meetings attached as context. These ride the ask as `callIds` — the same
   * context mechanic the Echo pane's @mention uses, reached here through
   * Sources → search. The agent still re-checks visibility server-side;
   * attaching is scoping, never authority.
   */
  const [contextCalls, setContextCalls] = useState<{ id: string; title: string }[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceHits, setSourceHits] = useState<SearchHit[]>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  /**
   * Web search (2026-08-18): REAL — the ask rides the provider's `:online`
   * variant, so the model searches the live web before answering. Off by
   * default: the scope promise («در محدودهٔ دسترسی خودتان») is the hub's
   * caption, and reaching outside it is a choice the person makes per
   * conversation, never a silent ambient behaviour.
   */
  const [webSearch, setWebSearch] = useState(false);
  /** The skill and model pickers — Sources-style hover menus, not selects. */
  const [skillOpen, setSkillOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const promptRef = useRef<HTMLInputElement>(null);
  const resetVersionRef = useRef(resetVersion);
  const appliedResetVersionRef = useRef(resetVersion);
  /** The mic dictates into the composer (it is NOT Echo's recorder). */
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", (text) =>
    setInput((v) => (v.trim() === "" ? text : `${v} ${text}`)),
  );
  /* system skills localize (shipped product content); authored names never do */
  const skillName = useSkillName();
  /* starters localize by the same shipped-content line as system names */
  const skillStarters = useSkillStarters();
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
  const promptSlug = params.get("prompt");
  const agentHandle = params.get("agent");
  const workflowSlug = params.get("workflow");
  const connectorProviderParam = params.get("connectorProvider");
  const sourceId = params.get("sourceId");
  const connectorProvider: ConnectorProvider | undefined = connectorProviderParam === "google" || connectorProviderParam === "microsoft"
    ? connectorProviderParam
    : undefined;
  const selectedAgent = agentHandle ? agents.find((candidate) => candidate.handle === agentHandle) : undefined;

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
    void api.agents().then(setAgents).catch(() => setAgents([]));
    void api.assistantTools().then(setToolNames).catch(() => setToolNames([]));
  }, []);

  /* A workflow launcher supplies the prompt by its server-owned slug. Never
     accept an invented value: an unknown slug would turn a selected card into
     a later 400 when the user sends their question. */
  useEffect(() => {
    if (promptSlug && skills.some((candidate) => candidate.slug === promptSlug)) {
      setSkill(promptSlug);
    }
  }, [promptSlug, skills]);

  /**
   * The Sources search — live, debounced, against the real index. Results
   * are calls the caller can already see (RLS filters the index by
   * construction); attaching one adds it to the ask's context.
   */
  useEffect(() => {
    const q = sourceQuery.trim();
    if (q.length === 0) {
      setSourceHits([]);
      setSourceBusy(false);
      return;
    }
    setSourceBusy(true);
    const timer = setTimeout(() => {
      void api
        .search(q)
        .then(setSourceHits)
        .catch(() => setSourceHits([]))
        .finally(() => setSourceBusy(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [sourceQuery]);

  /**
   * Keyboard shortcuts (the reference hub's, mapped to surfaces that exist):
   * Ctrl+Shift+A → agents, Ctrl+Shift+I → workflows,
   * `/` → focus the prompt. Registered on the hub only — a global map is the
   * platform shell's decision, not this page's to make.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const inField =
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      if (event.ctrlKey && event.shiftKey && event.code === "KeyA") {
        event.preventDefault();
        router.push("/agents");
      } else if (event.ctrlKey && event.shiftKey && event.code === "KeyI") {
        event.preventDefault();
        router.push("/workflows");
      } else if (event.key === "/" && !inField && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        promptRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  function attachCall(hit: SearchHit) {
    setContextCalls((prev) =>
      prev.some((c) => c.id === hit.call_id)
        ? prev
        : [...prev, { id: hit.call_id, title: hit.call_title }],
    );
  }

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
    const versionAtStart = resetVersionRef.current;
    const [thread, verdicts] = await Promise.all([
      api.agentMessages(id),
      api.sessionFeedback(id).catch(() => ({}) as Record<string, string>),
    ]);
    /* A just-cleared hub must not be repopulated by an older in-flight fetch. */
    if (versionAtStart !== resetVersionRef.current) return;
    setMessages(thread);
    setFeedback(verdicts);
    sessionId.current = id;
    setStarted(true);
    void api.shareState(id).then(setShared).catch(() => setShared(false));
  }, [setStarted]);

  useEffect(() => {
    resetVersionRef.current = resetVersion;
  }, [resetVersion]);

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
    if (resetVersion === 0 || appliedResetVersionRef.current === resetVersion) return;
    appliedResetVersionRef.current = resetVersion;
    /* Starting fresh also stops a live response. Otherwise its completion
       could put content back into the just-cleared hub. */
    abortRef.current?.abort();
    abortRef.current = null;
    sessionId.current = undefined;
    setMessages([]);
    setInput("");
    setFeedback({});
    setShared(false);
    setAttachments([]);
    setContextCalls([]);
    setCreateKind(null);
    setWebSearch(false);
    setAskError(null);
    setStreaming(false);
    if (resumeId) router.replace("/");
  }, [resetVersion, resumeId, router]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /**
   * Create → Doc delivers ITSELF: a download needs no click gesture, so the
   * moment a doc-tagged answer settles, the file lands ("fully works" means
   * nobody hunts for a button — it stays in the toolbar for re-downloading).
   * PDF cannot do this: print dialogs require a user gesture, so it remains
   * the prominent toolbar button. The ref makes each answer deliver ONCE —
   * every later render of the same settled message is a no-op.
   */
  const deliveredDocs = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (
        m.created === "doc" && !m.streaming && m.content &&
        m.failed !== true && !deliveredDocs.current.has(m.id)
      ) {
        deliveredDocs.current.add(m.id);
        deliverDoc(m.content, t("createDoc"));
      }
    }
  }, [messages, t]);

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
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === replyId);
            const emptyFailure =
              event.failed && (prev[idx]?.content ?? "") === "";
            return prev
              .map((m, i) => {
                if (m.id === replyId) {
                  return {
                    ...m,
                    streaming: false,
                    run_id: event.runId,
                    failed: event.failed,
                    error: event.error,
                  };
                }
                /* Shape A drops the empty reply below — so the server's
                   failure REASON (sent on `done`, previously discarded here)
                   moves onto the question it annotates. Client state only;
                   a reload re-derives the honest record from the server. */
                if (emptyFailure && i === idx - 1 && m.role === "user") {
                  return { ...m, failed: true, error: event.error };
                }
                return m;
              })
              /* a failed run with nothing said is no turn at all — the
                 question stands, which is what the server persisted */
              .filter((m) => !(m.id === replyId && emptyFailure));
          });
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
    setStarted(true);
    setSkillOpen(false);
    setInput("");
    setAskError(null);

    /*
     * Attachments travel INSIDE the question — the ask wire is text, and
     * the persisted record then shows exactly what the model was given
     * (the thread refetch renders it, deliberately: an invisible context
     * would be a prompt the record can't explain).
     */
    const authoredRequest =
      createKind === "doc"
        ? `${t("createDocRequest")}\n\n${typed}`
        : createKind === "pdf"
          ? `${t("createPdfRequest")}\n\n${typed}`
          : typed;
    const question =
      attachments.length === 0
        ? authoredRequest
        : attachments
            .map((a) => `[${t("attachmentTag")}: ${a.name}]\n${a.text}`)
            .join("\n\n") + `\n\n${authoredRequest}`;
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
      {
        id: replyId, role: "assistant", content: "", tool_calls: [], proposal: null,
        streaming: true,
        /* client-only tag: when this answer lands, the toolbar offers the
           promised deliverable (Save as PDF / download) — the Create chip
           used to only PREFIX the prompt, and the person got prose with no
           file (user report, 2026-08-20) */
        ...(createKind ? { created: createKind } : {}),
      },
    ]);

    await run(
      (signal) =>
        /* the attached meetings ARE the context — Sources made them chips,
           and this is where the chips become real scoping on the wire */
        api.ask(question, { page: "hub", callIds: contextCalls.map((c) => c.id) }, sessionId.current, {
          model: model || undefined,
          skill: skill || undefined,
          agent: agentHandle || undefined,
          workflow: workflowSlug || undefined,
          connectorProvider,
          sourceId: sourceId || undefined,
          web: webSearch,
          locale,
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
      (signal) => api.regenerate(sessionId.current!, { model: model || undefined, locale, signal }),
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

  const headerBtn =
    "tap flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-fg-muted hover:border-border-strong hover:text-fg";

  return (
    <div
      /* idle = the signed-off first screen, and it does NOT scroll (user
         directive): h-full + overflow-hidden pins it to the viewport, so
         nothing — not even an open popover — can grow the page. The active
         conversation keeps min-h-full: a thread is exactly the content
         that must be allowed to scroll. */
      /* idle WAS pinned to the viewport; the 2026-08-18 directive put real
         sections under the composer (suggestions, quick access), so the
         landing page scrolls again WHEN it must: min-h-full centers it on a
         tall screen and lets a short one scroll instead of clipping. */
      className={`relative isolate mx-auto flex w-full max-w-3xl flex-col px-5 ${
        idle ? "min-h-full items-center justify-center py-6 text-center" : "min-h-full py-6"
      }`}
    >
      {/* the conversation controls — visible whenever we are not idle */}
      {!idle ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link href="/conversations" className={headerBtn}>
            {t("history")}
          </Link>
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
          <div
            aria-hidden="true"
            className="neurai-watermark pointer-events-none absolute inset-0 -z-10 bg-center bg-no-repeat opacity-[0.035] [background-size:min(68vw,680px)]"
          />
          {selectedAgent ? (
            <section className="mb-1 flex max-w-[660px] items-center gap-4 rounded-3xl border border-border bg-surface/80 p-4 text-start shadow-sm" aria-label={t("activeAgent")}>
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-xl text-accent" aria-hidden>✦</span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-fg">{selectedAgent.name}</span>
                <span className="mt-1 block text-sm leading-5 text-fg-muted">{selectedAgent.description}</span>
              </span>
            </section>
          ) : (
            <>
              <p className="min-h-[1.25rem] text-sm text-fg-muted">
                {me ? t("greeting", { name: personName(me, locale) }) : ""}
              </p>
              <h1 className="mt-1.5 text-[25px] font-bold leading-snug tracking-tight text-fg md:text-[34px]">
                {t("ask")}
              </h1>
            </>
          )}
          {workflowSlug ? (
            <p className="mt-3 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              {t("activeWorkflow")}
            </p>
          ) : null}
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
            const activeStarters = active ? skillStarters(active) : [];
            return !selectedAgent && !workflowSlug && active && activeStarters.length > 0 ? (
              <div className="mt-4 flex w-full max-w-[660px] flex-wrap justify-center gap-2">
                {activeStarters.map((q) => (
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
            ref={promptRef}
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
        {contextCalls.length > 0 ? (
          /* the attached meetings — the visible half of the callIds wire */
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contextCalls.map((c) => (
              <span key={c.id} className="chip bg-accent-soft text-xs text-accent">
                @{c.title.slice(0, 24)}
                <button
                  type="button"
                  aria-label={t("removeContext", { name: c.title })}
                  className="ms-1 text-accent/70 hover:text-accent"
                  onClick={() => setContextCalls((prev) => prev.filter((x) => x.id !== c.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
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
          {/* CREATE — choosing a format makes it a visible chip beside the
              real request. It never pre-fills the editor. */}
          {createKind ? (
            <span className="flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-medium text-accent">
              <DocumentIcon width={14} height={14} />
              {createKind === "doc" ? t("createDoc") : t("createPdf")}
              <button
                type="button"
                className="tap -me-1 ms-0.5 grid h-5 w-5 place-items-center rounded-full text-accent/80 hover:bg-accent/10 hover:text-accent"
                aria-label={t("removeCreate", { name: createKind === "doc" ? t("createDoc") : t("createPdf") })}
                onClick={() => setCreateKind(null)}
              >
                ×
              </button>
            </span>
          ) : (
            <HoverMenu
              open={createOpen}
              onOpen={() => {
                setCreateOpen(true);
                setSourcesOpen(false);
              }}
              onClose={() => setCreateOpen(false)}
              panelClass="w-[19rem] p-2"
              button={
                <button
                  type="button"
                  className={headerBtn}
                  aria-expanded={createOpen}
                  aria-haspopup="menu"
                  onClick={() => setCreateOpen((v) => !v)}
                >
                  <PlusIcon width={14} height={14} />
                  {t("create")}
                </button>
              }
            >
              <div role="menu" aria-label={t("create")} className="space-y-1.5">
                {([
                  { key: "doc", title: t("createDoc"), description: t("createDocDescription") },
                  { key: "pdf", title: t("createPdf"), description: t("createPdfDescription") },
                ] as const).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className="tap flex w-full items-center justify-start gap-3 rounded-2xl bg-surface-2 px-3 py-3 text-start transition-colors hover:bg-accent-soft"
                    onClick={() => {
                      setCreateKind(item.key);
                      setCreateOpen(false);
                      requestAnimationFrame(() => promptRef.current?.focus());
                    }}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-fg-muted">
                      <DocumentIcon width={19} height={19} />
                    </span>
                    <span className="min-w-0 text-start">
                      <span className="block text-sm font-semibold text-fg">{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{item.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </HoverMenu>
          )}

          {/* SOURCES — attach real context: search meetings, add a text file.
              What the reference fakes as toggles, this menu does as acts. */}
          <HoverMenu
            open={sourcesOpen}
            onOpen={() => {
              setSourcesOpen(true);
              setCreateOpen(false);
            }}
            onClose={() => setSourcesOpen(false)}
            panelClass="w-[19rem] p-2"
            button={
              <button
                type="button"
                className={headerBtn}
                aria-expanded={sourcesOpen}
                aria-haspopup="menu"
                onClick={() => setSourcesOpen((v) => !v)}
              >
                {t("sources")}
                {contextCalls.length > 0 ? (
                  <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">
                    {contextCalls.length}
                  </span>
                ) : null}
              </button>
            }
          >
            <div>
                <input
                  autoFocus
                  className="input mb-1.5 h-9 w-full text-sm"
                  placeholder={t("sourcesSearch")}
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                />
                {sourceBusy ? (
                  <p className="px-2 py-1.5 text-xs text-fg-muted">{t("sourcesSearching")}</p>
                ) : sourceHits.length > 0 ? (
                  <ul className="max-h-44 overflow-y-auto">
                    {[...new Map(sourceHits.map((h) => [h.call_id, h])).values()].map((hit) => {
                      const attached = contextCalls.some((c) => c.id === hit.call_id);
                      return (
                        <li key={hit.call_id}>
                          <button
                            type="button"
                            className="tap flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-fg hover:bg-surface-2"
                            onClick={() => attachCall(hit)}
                          >
                            <span className="truncate">{hit.call_title}</span>
                            {attached ? (
                              <span className="text-[10px] text-accent">{t("sourcesAttached")}</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : sourceQuery.trim().length > 0 ? (
                  <p className="px-2 py-1.5 text-xs text-fg-muted">{t("sourcesNoHits")}</p>
                ) : null}
                <hr className="my-1.5 border-border" />
                <button
                  type="button"
                  className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-fg hover:bg-surface-2"
                  onClick={() => {
                    setSourcesOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  <PlusIcon width={14} height={14} />
                  {t("addFile")}
                </button>
                <hr className="my-1.5 border-border" />
                {/* REAL web search — the ask dispatches the model's :online
                    variant. A switch, because it is a per-conversation stance,
                    not an act. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={webSearch}
                  className="tap flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-fg hover:bg-surface-2"
                  onClick={() => setWebSearch((v) => !v)}
                >
                  <span>{t("searchWeb")}</span>
                  <span
                    aria-hidden
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      webSearch ? "bg-success" : "bg-surface-2 border border-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-all ${
                        webSearch ? "end-0.5" : "start-0.5"
                      }`}
                    />
                  </span>
                </button>
            </div>
          </HoverMenu>
          <HoverMenu
            open={toolsOpen}
            onOpen={() => setToolsOpen(true)}
            onClose={() => setToolsOpen(false)}
            panelClass="w-max max-w-[min(88vw,52rem)] overflow-x-auto p-3"
            button={
              <button
                type="button"
                className={headerBtn}
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((v) => !v)}
              >
                {t("tools")}
              </button>
            }
          >
            {/* the assistant's REAL reach, from the server's own registry —
                facts about what a question can trigger, not switches. Opens
                DOWNWARD; grows SIDEWAYS, never down (user directives): four
                rows, then a new column per four tools — a growing registry
                must widen the panel, not push it past the viewport */}
            <p className="mb-2 text-xs font-semibold text-fg">{t("toolsTitle")}</p>
            <ul className="grid grid-flow-col grid-rows-4 gap-x-8 gap-y-1.5">
              {toolNames.map((name) => (
                <li key={name} className="w-52 text-xs leading-5">
                  <span className={locale === "fa" ? "font-medium text-fg" : "ltr font-mono text-fg"}>
                    {locale === "fa" && TOOL_COMMAND_KEYS[name] ? t(TOOL_COMMAND_KEYS[name]) : name}
                  </span>
                  <span className="block text-fg-muted">{t(`tool_${name}`)}</span>
                </li>
              ))}
            </ul>
          </HoverMenu>
          <span className="flex-1" />
          {/*
            The model choice (M5 precedence: skill pin → this explicit choice
            → the saved preference; no product default underneath). "" =
            "let the server resolve", rendered as the saved-choice line.
          */}
          {skills.length > 0 ? (
            idle ? (
            /* the Sources anatomy on the skill picker (user directive):
               hover opens, leaving closes, the active row says so */
            <HoverMenu
              open={skillOpen}
              onOpen={() => setSkillOpen(true)}
              onClose={() => setSkillOpen(false)}
              align="end"
              panelClass="w-56 p-1.5"
              button={
                <button
                  type="button"
                  className={headerBtn}
                  aria-haspopup="menu"
                  aria-expanded={skillOpen}
                  onClick={() => setSkillOpen((v) => !v)}
                >
                  <span className="max-w-[9rem] truncate">
                    {skill ? skillName(skills.find((s) => s.slug === skill) ?? skills[0]!) : t("skillDefault")}
                  </span>
                  <Chevron />
                </button>
              }
            >
              <div role="menu" aria-label={t("skillPicker")}>
                {[{ slug: "", label: t("skillDefault") }, ...skills.map((s) => ({ slug: s.slug, label: skillName(s) }))].map(
                  (row) => (
                    <button
                      key={row.slug || "@default"}
                      type="button"
                      role="menuitemradio"
                      aria-checked={skill === row.slug}
                      className={`tap flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 ${
                        skill === row.slug ? "font-semibold text-accent" : "text-fg"
                      }`}
                      /* value = SLUG: core's resolver takes /slug, not an id —
                         an id here would 400 as "unknown skill" on every ask */
                      onClick={() => {
                        setSkill(row.slug);
                        setSkillOpen(false);
                      }}
                    >
                      <span className="truncate">{row.label}</span>
                      {skill === row.slug ? <span aria-hidden>✓</span> : null}
                    </button>
                  ),
                )}
              </div>
            </HoverMenu>
            ) : (
              <button
                type="button"
                className={`${headerBtn} cursor-not-allowed opacity-55`}
                disabled
                aria-label={t("skillPicker")}
              >
                <span className="max-w-[9rem] truncate">
                  {skill ? skillName(skills.find((s) => s.slug === skill) ?? skills[0]!) : t("skillDefault")}
                </span>
                <Chevron />
              </button>
            )
          ) : null}
          {models.length > 0 ? (
            <HoverMenu
              open={modelOpen}
              onOpen={() => setModelOpen(true)}
              onClose={() => setModelOpen(false)}
              align="end"
              panelClass="w-72 p-1.5"
              button={
                <button
                  type="button"
                  className={headerBtn}
                  aria-haspopup="menu"
                  aria-expanded={modelOpen}
                  onClick={() => setModelOpen((v) => !v)}
                >
                  <span className="max-w-[10rem] truncate ltr">
                    {modelLabel(models.find((m) => m.id === model)?.name ?? model)}
                  </span>
                  <Chevron />
                </button>
              }
            >
              {models.length > 12 ? (
                /* the catalogue is hundreds of rows — a picker without a
                   filter is a scroll test, not a choice */
                <input
                  className="input mb-1.5 h-9 w-full text-sm"
                  placeholder={t("modelFilter")}
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                />
              ) : null}
              <div role="menu" aria-label={t("modelPicker")} className="max-h-64 overflow-y-auto">
                {models
                  .filter((m) => {
                    const f = modelFilter.trim().toLowerCase();
                    return f === "" || m.id.toLowerCase().includes(f) || modelLabel(m.name).toLowerCase().includes(f);
                  })
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={model === m.id}
                      className={`tap flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 ${
                        model === m.id ? "font-semibold text-accent" : "text-fg"
                      }`}
                      onClick={() => {
                        setModel(m.id);
                        setModelOpen(false);
                      }}
                    >
                      <span className="truncate ltr">{modelLabel(m.name)}</span>
                      {model === m.id ? <span aria-hidden>✓</span> : null}
                    </button>
                  ))}
              </div>
            </HoverMenu>
          ) : null}
        </div>
      </div>

      {/* The Echo card sits DIRECTLY under the prompt box (user directive,
          2026-08-18 — it replaces the Conversations pill, which is renamed
          History and lives in the left rail with the platform's other
          destinations). The apps are the hub's second sentence: ask above,
          open an app below. */}
      {idle ? (
        <div className="mt-4 grid w-full max-w-[660px] grid-cols-[repeat(auto-fill,minmax(226px,1fr))] gap-3">
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

      {/* SUGGESTIONS (user directive, 2026-08-18): one row per skill that
          ships starter questions — the reference hub's suggestion list, fed
          by the product's own skills rather than an invented catalogue. A
          press selects the skill AND fills the composer; sending stays the
          person's act (the shipped rule, unchanged). */}
      {idle && !selectedAgent && !workflowSlug && skills.some((s) => s.starter_questions.length > 0) ? (
        <section className="mt-7 w-full max-w-[660px] self-start text-start" aria-label={t("suggestions")}>
          <p className="mb-1 px-1 text-group-label font-medium text-fg-subtle">
            {t("suggestions")}
          </p>
          <ul>
            {skills
              .filter((s) => s.starter_questions.length > 0)
              .slice(0, 6)
              .map((s) => (
                <li key={s.id} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    className="tap flex w-full items-center justify-start gap-3 px-1 py-3 text-start text-sm text-fg-muted transition-colors hover:text-fg"
                    onClick={() => {
                      setSkill(s.slug);
                      setInput(skillStarters(s)[0] ?? "");
                      promptRef.current?.focus();
                    }}
                  >
                    <ToolsIcon width={15} height={15} className="shrink-0 text-fg-subtle" />
                    <span className="min-w-0 truncate">
                      {skillStarters(s)[0]}
                      <span className="ms-2 text-xs text-fg-subtle">{skillName(s)}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {/* Quick access LEFT the hub's face (user directive, 2026-08-18): its
          destinations live in the left rail beside History now. The
          Ctrl+⇧+A / Ctrl+⇧+I shortcuts stay registered above, and the rail
          tooltips carry them. */}
    </div>
  );
}

/**
 * A hover-driven menu in the Sources panel's clothes (user directive,
 * 2026-08-18: every composer menu opens when the mouse arrives and leaves
 * with it; the skill and model pickers stop being native selects).
 *
 * The `pt-2` wrapper is the load-bearing part: the visual gap between pill
 * and panel belongs to the PANEL's box, so crossing it never fires
 * mouseleave. A margin there instead closes the menu halfway to the first
 * row. Click still toggles, which is what a touch screen has.
 */
function HoverMenu({
  open,
  onOpen,
  onClose,
  align = "start",
  button,
  panelClass,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  align?: "start" | "end";
  button: ReactNode;
  panelClass: string;
  children: ReactNode;
}) {
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      {button}
      {open ? (
        <div className={`absolute ${align === "start" ? "start-0" : "end-0"} top-full z-30 pt-2`}>
          <div
            className={`rounded-xl border border-border bg-surface text-start shadow-lg ${panelClass}`}
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The pickers' chevron — the one visual the native select used to provide. */
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
