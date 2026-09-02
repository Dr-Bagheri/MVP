"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, BffError } from "@/api/client";
import type { AgentCard, AgentEvent, AgentMessage, ConnectorProvider, MailDraft, SearchHit, Skill, WorkflowCard } from "@/api/types";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDictation } from "@/lib/dictation";
import { deliverDoc } from "@/lib/deliver";
import { subscribeComposer, takePendingDraft } from "@/lib/assistantBus";
import { shouldStick } from "@/lib/threadFollow";
import { useSkillStarters } from "@/lib/skillName";
import { ConversationThread } from "./ConversationThread";
import { AgentOverviewPanel } from "./AgentOverviewPanel";
import { MailDraftCard } from "./MailDraftCard";
import { useAssistantConversation } from "./AssistantConversationState";
import { DocumentIcon, MicIcon, PlusIcon, SendIcon } from "./icons";
import { SURFACE_TOOLS } from "@/lib/agentSurface";
import { startRecording } from "@/lib/recordingEngine";

type CreateKind = "doc" | "pdf";

/**
 * A stream that ended without `done` — the transport died (proxy timeout,
 * dropped tunnel), it did not succeed. Its own class so the catch can tell
 * "the run died mid-air" from "the run never started": the two nothings get
 * different copy, and only the second one may claim nothing ever ran.
 */
class StreamDiedError extends Error {
  constructor() {
    super("stream ended without done");
    this.name = "StreamDiedError";
  }
}

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
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [workflowCards, setWorkflowCards] = useState<WorkflowCard[]>([]);
  /**
   * M43 — the replies written in THIS conversation. Fetched rather than
   * streamed: a draft is a row with a lifecycle (it can be sent from the
   * mailbox, or from another tab), so the thread reads the current state
   * instead of trusting what it saw written once.
   */
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  /* which providers may SEND — a connection can read mail and refuse to send
     it, and the card must not offer a button that fails at the provider */
  const [canSend, setCanSend] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
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
  const promptRef = useRef<HTMLInputElement>(null);
  const resetVersionRef = useRef(resetVersion);
  const appliedResetVersionRef = useRef(resetVersion);
  /** The mic dictates into the composer (it is NOT Echo's recorder). */
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", (text) =>
    setInput((v) => (v.trim() === "" ? text : `${v} ${text}`)),
  );
  /* system skills localize (shipped product content); authored names never do */

  /* a suggestion pressed in the sub-menu: applied on arrival (the mailbox)
     and while already here (the subscription). Selecting the skill with it
     matters — the starter question is written for that skill's prompt. */
  useEffect(() => {
    const apply = (draft: { text: string; skillSlug?: string }) => {
      if (draft.skillSlug) setSkill(draft.skillSlug);
      setInput(draft.text);
      promptRef.current?.focus();
    };
    const waiting = takePendingDraft();
    if (waiting) apply(waiting);
    return subscribeComposer(apply);
  }, []);
  /* starters localize by the same shipped-content line as system names */
  const skillStarters = useSkillStarters();
  /** Held in a ref, not state: it is read inside the stream loop, where a
   *  stale closure over state would silently start a second conversation. */
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  /** The thread's own scroll box (md+) — the page never scrolls for it. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * AUTO-FOLLOW state, a ref because it must never cause a render: whether
   * the reader is at (or near) the bottom of the thread. While pinned, every
   * new message and streaming delta keeps the latest answer in view. When
   * the person has scrolled UP to re-read something older, we do NOT yank
   * them back down — that is the difference between following and fighting.
   * They re-pin by returning to the bottom (the scroll handler notices), or
   * by sending a message themselves (their own act at the composer). The
   * decision lives in lib/threadFollow, pure, where the scrolled-up case is
   * unit-testable — jsdom cannot lay out, so the DECISION is what tests can
   * actually hold. `overflow-anchor` alone is not reliable across our
   * browsers; the behaviour is written, not hoped for.
   */
  const pinnedRef = useRef(true);

  /**
   * Resume is driven by a URL param (`?c=<id>`), not component state: Back
   * leaves a conversation, reload returns to it, a thread can be linked.
   */
  const params = useSearchParams();
  const resumeId = params.get("c");
  const promptSlug = params.get("prompt");
  const agentHandle = params.get("agent");
  const workflowSlug = params.get("workflow");

  /*
   * WHICH workflows this person wants recorded when they run them (db/0142).
   * Read once; an empty set is the ordinary case and costs nothing.
   */
  const [recordOnRun, setRecordOnRun] = useState<readonly string[]>([]);
  const [recordOnAgent, setRecordOnAgent] = useState<readonly string[]>([]);
  useEffect(() => {
    void api.me()
      .then((who) => {
        setRecordOnRun(who?.record_on_workflows ?? []);
        setRecordOnAgent(who?.record_on_agents ?? []);
      })
      .catch(() => { setRecordOnRun([]); setRecordOnAgent([]); });
  }, []);

  /*
   * A FLAGGED AGENT ARMS A TAKE; THE FIRST PROMPT STARTS IT.
   *
   * Selecting an agent used to start the recording on the spot, and that was
   * wrong in the way a person notices immediately (user report): picking an
   * agent is reading a card, not beginning a conversation. Someone opening
   * the agent to see what it does — or clicking through three of them to
   * choose — had a live microphone for each one.
   *
   * So the effect only ARMS: it remembers which handle a take is owed for.
   * `send` fires it, once, when a question is actually asked. `startedFor`
   * then remembers which handle it fired for, so switching away and back does
   * not start a second take; the engine refuses one anyway, which is the belt
   * to this brace.
   */
  const armedAgent = useRef<string | null>(null);
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!agentHandle || !recordOnAgent.includes(agentHandle)) {
      armedAgent.current = null;
      return;
    }
    if (startedFor.current === agentHandle) return;
    armedAgent.current = agentHandle;
  }, [agentHandle, recordOnAgent]);
  const connectorProviderParam = params.get("connectorProvider");
  const sourceId = params.get("sourceId");
  /** the launcher's "this is a run, not a visit" (see the auto-run effect) */
  const autoRun = params.get("run") === "1";
  const connectorProvider: ConnectorProvider | undefined = connectorProviderParam === "google" || connectorProviderParam === "microsoft"
    ? connectorProviderParam
    : undefined;
  const selectedAgent = agentHandle ? agents.find((candidate) => candidate.handle === agentHandle) : undefined;

  /*
   * The starter questions, through `useSkillStarters` — a SYSTEM skill's are
   * shipped product copy and localize; an org-authored skill's are its
   * author's words and come off the wire untouched. Resolving them here (and
   * not reading the wire directly) is what keeps the English hub from
   * suggesting «کارهای این تماس را فهرست کن».
   */
  const suggestions = skills.flatMap((s) => skillStarters(s)).slice(0, 4);

  useEffect(() => {
    /*
     * The MODELS CATALOGUE is still read, and `model` still rides the ask —
     * only the picker left (user directive, 2026-09-02: "remove the models
     * and skills as well").
     *
     * Keeping the read is the load-bearing part, and the reason is written in
     * this repo twice: a saved preference outlives the catalogue. The first
     * member's was `~anthropic/claude-opus-latest`, saved while it was served
     * and barred the day the no-Claude filter learned to spell it — and every
     * ask then sent a name the server never offered and came back 400. So the
     * client still adopts only a model the server OFFERED; what changed is
     * that nobody has to choose one.
     */
    void api.models().then((res) => {
      const offered = res.preferred_model !== null
        && res.models.some((m) => m.id === res.preferred_model);
      setModel((offered ? res.preferred_model : res.models[0]?.id) ?? "");
    }).catch(() => setModel(""));
    void api.skills().then(setSkills).catch(() => setSkills([]));
    void api.agents().then(setAgents).catch(() => setAgents([]));
    /* the workflow CARDS: the auto-run's opening line is the workflow's own
       name, which is the server's string — the client never invents the
       sentence a workflow is called by */
    void api.workflows().then(setWorkflowCards).catch(() => setWorkflowCards([]));
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
   * THE WORKFLOW RUN (user report, 2026-08-27: "I clicked one and nothing
   * happens, nothing returns").
   *
   * Choosing the email IS the instruction. Before this, arriving here with a
   * workflow and a source rendered a pill and waited for the person to think
   * of a question — so the product asked the user to describe the workflow
   * they had just pressed. The run now starts itself, and the thread it
   * writes is the record of it.
   *
   * Fires ONCE per (workflow, source): `ranRef` holds the triple rather than
   * a boolean, so picking a second email in the same mount runs again while
   * a re-render never re-sends. Never on a resumed thread (`?c=`) and never
   * over an existing conversation — an auto-send into someone's open thread
   * is a message they did not write.
   */
  const ranRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRun || resumeId || streaming) return;
    /*
     * WAIT FOR THE MODEL. The catalogue arrives on its own request, and the
     * auto-run used to fire the moment the workflow cards landed — whichever
     * came first. When the models lost that race the ask carried no model,
     * the server fell back to the stored preference, and the person watched
     * their workflow end on a refusal about a model they never chose
     * (2026-08-27, live). A run that starts itself has to be at least as
     * complete as one a person starts.
     */
    if (model === "") return;
    if (!workflowSlug || !connectorProvider || !sourceId) return;
    if (messages.length > 0) return;
    const card = workflowCards.find((candidate) => candidate.slug === workflowSlug);
    /* an unknown slug is not a run: the server would refuse it, and a
       question nobody typed failing is worse than no question */
    if (!card) return;
    const key = `${workflowSlug}:${connectorProvider}:${sourceId}`;
    if (ranRef.current === key) return;
    ranRef.current = key;
    /*
     * START A TAKE ALONGSIDE THE RUN, if this person asked for it on this
     * workflow (db/0142, user directive 2026-08-29).
     *
     * Here rather than in the graph, because this is the only place a
     * workflow runs with a microphone present: steps execute in the worker.
     * `startRecording` is the ENGINE the record button uses, so the mini
     * recorder appears in the top bar and the take is captured while the
     * workflow does its work.
     *
     * Guarded by the same `ranRef` as the run itself, so a reload cannot
     * start a second recording — and the engine refuses a second take
     * anyway, which is the belt to this brace.
     */
    if (recordOnRun.includes(workflowSlug)) {
      void startRecording({
        micId: "",
        language: locale === "en" ? "en" : "fa",
        source: "mic",
        title: card.name,
        locale,
        resume: null,
        boost: false,
        noiseSuppression: true,
      });
    }
    void send(card.name);
    /* disarm: the source stays on the URL so follow-ups keep the email in
       context, but `run` is spent. Without this a reload is a second run of
       a workflow the person started once — real model spend, and a thread
       they did not ask for. */
    router.replace({
      pathname: "/assistant",
      query: { workflow: workflowSlug, connectorProvider, sourceId },
    } as never);
  }, [autoRun, resumeId, streaming, model, workflowSlug, connectorProvider, sourceId,
      messages.length, workflowCards, router, recordOnRun, locale]);

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

  const refreshDrafts = useCallback(async (sessionForDrafts: string | undefined) => {
    if (!sessionForDrafts) return;
    /* try/catch, not only `.catch`: a client that does not have this method
       at all throws SYNCHRONOUSLY, and a rejection handler never sees it —
       which is how a missing method became an unhandled error beside a green
       suite rather than the quiet degrade this line intends */
    try {
      await api.mailDrafts({ session: sessionForDrafts })
      .then(async (found) => {
        setDrafts(found);
        if (found.length === 0) return;
        /* asked only when there IS a draft: the connector list is a second
           request, and a conversation with no drafts owes nobody one */
        await api.connectors()
          .then((list) => setCanSend(Object.fromEntries(
            list.map((c) => [c.provider, c.can_draft === true]))))
          .catch(() => { /* unknown stays unknown; the card assumes it can */ });
      })
      .catch(() => { /* an un-migrated deployment has no drafts, not an error */ });
    } catch {
      /* same reason: absent is not broken */
    }
  }, []);

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
    /* a freshly opened thread shows its LATEST turn — re-pin here, not in
       adoptThread: adoptThread also runs after every `done`, where re-pinning
       would yank a reader who scrolled up mid-answer */
    pinnedRef.current = true;
    let cancelled = false;
    void adoptThread(resumeId).then(() => {
      if (cancelled) return;
      /* a resumed conversation shows its drafts again: the card is the only
         place the reply can be sent from inside the product, so coming back
         to the thread has to bring it back too */
      void refreshDrafts(resumeId);
    });
    return () => {
      cancelled = true;
    };
  }, [resumeId, adoptThread, refreshDrafts]);

  useEffect(() => {
    if (resetVersion === 0 || appliedResetVersionRef.current === resetVersion) return;
    appliedResetVersionRef.current = resetVersion;
    /* Starting fresh also stops a live response. Otherwise its completion
       could put content back into the just-cleared hub. */
    abortRef.current?.abort();
    abortRef.current = null;
    sessionId.current = undefined;
    pinnedRef.current = true;
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
    /* `/assistant`, not `/` — the hub's own address. `/` became the
       dashboard (2026-08-25) and this line kept sending "new conversation"
       to a briefing screen; same seam as the workflow launcher's. */
    if (resumeId) router.replace("/assistant");
  }, [resetVersion, resumeId, router]);

  useEffect(() => {
    /* Follow only while pinned — see pinnedRef for the reasoning. Instant,
       not smooth: a smooth scroll issued on every streaming delta lags its
       own target and judders; pinning is a position, not an animation. */
    if (!pinnedRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    /* Below md the thread box does not scroll (the page scrolls as one, the
       mobile layout deliberately untouched) — the sentinel carries the
       follow there. On md+ the box is already at its bottom, so this
       ancestor-scroll is a no-op. */
    threadEnd.current?.scrollIntoView({ block: "end" });
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

  /* the dashboard LEFT this component (user directive, 2026-08-25): it is
     the landing PAGE now (components/platform/Dashboard.tsx), not a view of
     the hub — a briefing and a conversation are different screens */

  /**
   * One reducer for ask and regenerate — same events, same thread.
   *
   * `progress` is written as events arrive so `run` can tell three endings
   * apart: a clean finish (`sawDone`), a stream that broke after saying
   * something (`sawAny` without `sawDone`), and one that ended before a
   * single frame. The wire contract (core sse.ts) is explicit: `done` is
   * ALWAYS the last event, including on failure, so **a stream that simply
   * ends without it died in transport — it is never a success**. The pane
   * implemented that rule from day one; the hub did not, and a dropped
   * proxy connection walked the success path here in silence.
   */
  async function consume(
    stream: AsyncGenerator<AgentEvent>,
    replyId: string,
    progress: { sawAny: boolean; sawDone: boolean },
  ) {
    for await (const event of stream) {
      progress.sawAny = true;
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
          progress.sawDone = true;
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
                  };
                }
                /* Shape A drops the empty reply below — the failed flag moves
                   onto the question it annotates. The raw failure SENTENCE is
                   deliberately not carried (user directive, 2026-08-20): a
                   provider's JSON under a chat reads as debug output; the
                   reason lives on the audit surface and in the server log. */
                if (emptyFailure && i === idx - 1 && m.role === "user") {
                  return { ...m, failed: true };
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
    const progress = { sawAny: false, sawDone: false };
    try {
      await consume(start(controller.signal), replyId, progress);
      /*
       * **A stream that ends without `done` died in transport.** The wire
       * contract (core sse.ts: "done is ALWAYS the last event, including on
       * failure — the client treats stream-end-without-done as a transport
       * failure") had only one half built: core never drops the stream
       * silently, and the hub never checked. A proxy timeout closing the
       * SSE body cleanly (the Cloudflare tunnel, Vercel's duration kill —
       * both on record for this deployment) therefore walked the SUCCESS
       * path: no error, no annotation, a reply stuck on "thinking" — and
       * when the cut landed on a conversation's opening turn before the
       * `session` frame, the id never arrived, so the person's next message
       * silently opened a NEW conversation under the old thread. The
       * assistant "forgot everything" while the screen looked connected
       * (user report, 2026-08-28). Refusing the silent ending here is what
       * makes the death visible; the session ref is deliberately left
       * untouched below, so when the id IS known the next message continues
       * the same conversation.
       */
      if (!progress.sawDone) throw new StreamDiedError();
      // adopt the persisted rows — the toolbar needs server ids
      if (sessionId.current) await adoptThread(sessionId.current);
      await refreshDrafts(sessionId.current);
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
        /*
         * Settle the turn the way `done` would have (Shape A/B, mirrored
         * from the done-handler): a reply that said NOTHING is no turn at
         * all — it goes, and the failed flag moves onto the question it
         * annotates; a PARTIAL reply is a real turn that ended badly — it
         * stays, settled and marked, so the existing annotation renders
         * under it. Never a synthetic bubble (standing rule): the thread is
         * the record, and our commentary must not be able to join it. The
         * old code removed only EMPTY replies, which left a partial one
         * blinking its caret forever on a dead stream.
         */
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === replyId);
          const empty = (prev[idx]?.content ?? "") === "";
          return prev
            .map((m, i) => {
              if (m.id === replyId) return { ...m, streaming: false, failed: true };
              if (empty && i === idx - 1 && m.role === "user") return { ...m, failed: true };
              return m;
            })
            .filter((m) => !(m.id === replyId && empty));
        });
        /*
         * The refusal's own sentence, rendered — the previous version knew
         * only "the run did not finish" and swallowed WHY, which left the
         * user staring at an unanswered question with no lever to pull.
         * The server names the problem ("no model selected…"); saying it
         * is the difference between a bug report and a fixed dropdown.
         *
         * But only where the sentence is TRUE (distinguish the kinds of
         * nothing): `askFailed` says "refused before a run started", which
         * is right for a refusal or a fetch that never connected, and a
         * false claim for a stream that died mid-answer — there the run DID
         * start, and the annotation on the turn is the honest sign.
         */
        if (cause instanceof BffError) {
          setAskError(cause.detail ?? t("askFailed"));
        } else if (!(cause instanceof StreamDiedError) && !progress.sawAny) {
          setAskError(t("askFailed"));
        }
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  /**
   * `text` is the auto-run's: state is not readable in the same tick it is
   * set, so the workflow's opening line travels as an argument rather than
   * through `setInput` (both call sites pass nothing, deliberately — a
   * bare `onClick={send}` would hand this a MouseEvent).
   */
  async function send(text?: string) {
    const typed = (text ?? input).trim();
    if (typed === "" || streaming) return;

    /*
     * The armed take starts HERE — after the guard, so an empty box or a
     * press during a stream starts nothing, and only ever on a real
     * question. See the arming effect for why selecting the agent is not
     * enough.
     */
    if (armedAgent.current !== null && armedAgent.current === agentHandle) {
      startedFor.current = armedAgent.current;
      armedAgent.current = null;
      void startRecording({
        micId: "", language: locale === "en" ? "en" : "fa", source: "mic",
        title: "", locale, resume: null, boost: false, noiseSuppression: true,
      });
    }

    /* sending re-pins: the person just acted at the composer, and a thread
       that does not show the question they sent reads as having eaten it */
    pinnedRef.current = true;
    setStarted(true);
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
          /*
           * THE ASSISTANT PAGE CAN ACT, not only answer (user directive,
           * 2026-08-29: "for the agents to add this so they can also start
           * the call").
           *
           * `SURFACE_TOOLS` was advertised by the voice orb alone, so a
           * TYPED ask — including every ask made through an agent, since
           * agents are asked from here — reached a model that had been told
           * about no client tools at all. Asking "start recording" got a
           * polite explanation instead of a recording, and the cause was
           * invisible from either side: the orb worked, so the tools worked;
           * this page answered, so the page worked.
           *
           * One list, spread from the module that owns it, so the two
           * surfaces cannot drift into advertising different capabilities.
           */
          clientTools: [...SURFACE_TOOLS],
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
      /*
       * THE COMPOSER SITS AT THE FOOT, always (user directive, 2026-08-26:
       * "the assistant page should look like this with the prompt box at
       * the bottom but nothing in the middle").
       *
       * The idle state used to centre a greeting and a headline in the
       * middle of the screen; both are gone. `justify-end` puts the one
       * control that matters where the hand already is, and the empty
       * space above it is the point rather than somewhere to put things.
       */
      /* the TABLE width (user directive, 2026-08-27: "as large as the
         tables"). `max-w-3xl` was the outer cap, so widening the composer
         alone changed nothing — the child could not exceed its parent, which
         is why this line and not just that one. */
      /* the page rhythm's gutters and top, from the theme. The BOTTOM stays
         `pb-6` rather than the page's `pb-page-bottom`: the composer is
         sticky at the foot, and 64px under it would be dead space the
         conversation has to scroll past on every turn. */
      /*
       * THE ASSISTANT'S OWN SCROLL (user directive, 2026-08-28, the Sana
       * shape: "the scroll is just for the prompt and its answers, the page
       * does not need to scroll down"). In the ACTIVE state on md+ this
       * column is bounded — `md:h-full` takes exactly the height the shell's
       * content column grants, `md:overflow-hidden` refuses to grow past it,
       * and the THREAD below is the one thing that scrolls. `md:max-h-dvh`
       * is the belt: another lane is fixing the shell's scroller, and if
       * that chain ever breaks (h-full degrading to auto under a parent with
       * no height), the viewport bound still keeps the thread scrolling
       * inside one screen instead of growing the page. Below md nothing
       * changes: the page scrolls as one, which is right on a phone, and
       * the sticky composer stays visible there (it is inert on md+, where
       * the column never scrolls).
       */
      className={`relative isolate mx-auto flex w-full max-w-content flex-col px-page-inline pt-page-sm md:px-page-inline-md md:pt-page ${
        idle
          ? "min-h-full justify-end pb-6"
          : "min-h-full pb-6 md:min-h-0 md:h-full md:max-h-dvh md:overflow-hidden"
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

      {/*
       * M47 — the overview that comes up WITH the agent (Sana's shape): its
       * workflows and its reach, above the thread and never over it. Keyed
       * by hub state so the first message REMOUNTS it folded — the panel's
       * job is done once the conversation is the screen's subject, and a
       * same-children re-render would keep it open (the children-bailout
       * lesson: a re-render is not a remount). The idle centrepiece below
       * stays exactly the user-approved anatomy; this renders only when an
       * agent is picked.
       */}
      {selectedAgent ? (
        <AgentOverviewPanel
          key={idle ? "agent-panel-idle" : "agent-panel-active"}
          agent={selectedAgent}
          defaultCollapsed={!idle}
        />
      ) : null}

      {idle ? (
        <>
          {/* THE WATERMARK IS GONE (user directive, 2026-09-02: "also remove
                the background"). A brand mark behind the one screen whose
                job is a blank prompt is decoration competing with an empty
                box — and at 3.5% it was visible enough to notice and too
                faint to read, which is the worst of both. */}
          {/* the picked-agent chip that lived here grew into the
              AgentOverviewPanel above — one panel, both hub states */}
          {workflowSlug ? (
            <p className="mx-auto mt-3 w-fit rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              {t("activeWorkflow")}
            </p>
          ) : null}

          {/*
            THE SUGGESTIONS ARE BACK ON THE HUB (user directive, 2026-09-02:
            "with the suggestion on top after its first pre-answer
            conversation"). They spent a while in the side menu, where they
            read as a list of features; under the assistant's opening line
            they read as things to say, which is what they are.
            Every shipped skill's starters, not just a picked one's — the
            skill picker went in the same round, so "the active skill" is now
            always the default and gating on it would have shown nothing.
            One press FILLS the composer; sending stays the person's act,
            which is the rule these rows have carried since they existed.
          */}
          {!selectedAgent && !workflowSlug && suggestions.length > 0 ? (
            <div className="mx-auto mt-4 flex w-full max-w-content flex-wrap justify-center gap-2">
              {suggestions.map((q) => (
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
          ) : null}
        </>
      ) : (
        <div
          ref={scrollerRef}
          /* the ONE scrolling region of the active assistant page (md+):
             `min-h-0` lets a flex child actually shrink below its content,
             which is what makes `overflow-y-auto` mean something here. The
             handler keeps the follow decision current — recomputed on every
             scroll, the reader's own or ours, so returning to the bottom
             re-pins without a button. */
          onScroll={(e) => {
            pinnedRef.current = shouldStick(e.currentTarget);
          }}
          className="scroll-quiet mb-4 flex-1 md:min-h-0 md:overflow-y-auto"
        >
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
          {drafts.map((draft) => (
            <MailDraftCard
              key={draft.id}
              draft={draft}
              canSend={canSend[draft.provider] !== false}
              onChanged={(next) => setDrafts((prev) =>
                prev.map((entry) => (entry.id === next.id ? next : entry)))}
            />
          ))}
          <div ref={threadEnd} />
        </div>
      )}

      <div
        /* focus-within: the PANEL is the control, so the panel carries the
           focus affordance — the global :focus-visible ring on the inner
           input drew a box inside a box (the user's report) */
        /* the composer takes the TABLE width (user directive, 2026-08-27:
           "as large as the tables"). 660px was a reading measure chosen when
           the hub was a centred landing card; on a page whose job is a
           conversation it left the prompt floating in a column half the width
           of every other surface in the product. */
        className={`w-full max-w-content rounded-2xl border border-border-strong bg-surface p-3 text-start transition-colors focus-within:border-accent ${
          idle ? "mx-auto mt-auto" : "sticky bottom-0 mx-auto"
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
          {/* THE RECORDER LEFT THE COMPOSER (user directive, 2026-09-02:
              "remove record from it as well"). It started an Echo take from
              the assistant's prompt box — two products in one control, on the
              screen whose whole job is a sentence. The recorder still lives
              on the meeting, which is where a recording belongs. */}
          {/* The Tools menu was REMOVED from the composer (user directive,
              2026-08-20). It listed the assistant's tool registry — facts,
              not switches — and reads better as documentation than as a
              composer control. The registry itself (api.assistantTools) still
              powers the Agents create-modal's tool checkboxes. */}
          {/* THE MODEL AND SKILL PICKERS ARE GONE (user directive,
              2026-09-02: "remove the models and skills as well").
              Both were choices about HOW the assistant answers, offered
              beside the box where a person says WHAT they want — and the M5
              ladder already answers the model question without being asked
              (skill pin → saved preference → the org's list). What a picker
              added was a decision to make before typing.
              The ladder is untouched: `model` stays in the ask payload and
              the server still resolves it. What left is the control, not the
              capability — and a person who wants a particular model still
              sets it once in Settings rather than every time they type. */}
        </div>
      </div>

      {/* The Echo card MOVED to the dashboard (user directive, 2026-08-26).
          It sat under the prompt box from 2026-08-18, when the hub was the
          landing page and "ask above, open an app below" was that page's
          whole sentence. The dashboard is the landing page now, so the app
          launcher belongs there — and the assistant's own page is a
          conversation, which an app card interrupts rather than completes. */}

      {/* SUGGESTIONS moved to the SUB-MENU (user directive, 2026-08-26).
          They arrive back here through the composer mailbox: the press
          usually happens on another page, so the draft waits in
          assistantBus until this page mounts and takes it. */}

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
 * The padding wrapper is the load-bearing part: the visual gap between pill
 * and panel belongs to the PANEL's box, so crossing it never fires
 * mouseleave. A margin there instead closes the menu halfway to the first
 * row. Click still toggles, which is what a touch screen has. (It is `pb-2`
 * now that the panels open upward — same reason, other side.)
 */
/**
 * THE COMPOSER'S MENUS — the platform's popover, opening upward.
 *
 * User directive, 2026-09-02: "change the shape for create, make it the same
 * as any dropdown that we have, just it opens upward — rewrite it whole so it
 * becomes one with the theme itself; also do it for the sources."
 *
 * What this replaced was a hand-positioned `absolute bottom-full` panel that
 * opened on HOVER, and both halves were wrong in the same way — they were
 * this file's private answers to questions the platform had already answered.
 * Hover in particular: a menu that opens because a pointer passed over it is
 * a menu that opens by accident, and it has no keyboard equivalent at all.
 *
 * `side="top"` is a preference rather than a rule: Radix flips it when there
 * is no room above, which is the half a hand-written `bottom-full` cannot do
 * and the reason the old panel could be clipped on a short viewport.
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
    <Popover open={open} onOpenChange={(next) => (next ? onOpen() : onClose())}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        side="top"
        align={align}
        sideOffset={8}
        className={`w-auto rounded-xl border-border bg-surface p-0 text-start shadow-island ${panelClass}`}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

