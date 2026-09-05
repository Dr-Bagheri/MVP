"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorProvider, ConnectorStatus, MailDraft, Skill, WorkflowCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { SkeletonLines } from "@/components/scaffold";
import { micTone, useDictation } from "@/lib/dictation";
import { usePushToTalk } from "@/lib/usePushToTalk";
import { deliverDoc } from "@/lib/deliver";
import { subscribeComposer, takePendingDraft } from "@/lib/assistantBus";
import { shouldStick } from "@/lib/threadFollow";
import { useSkillStarters } from "@/lib/skillName";
import { ConversationThread } from "./ConversationThread";
import {
  adoptAssistantThread, askAssistant, assistantServerSnapshot, assistantSnapshot,
  regenerateAssistant, registerAssistantSurface, resetAssistantSession,
  stopAssistant, subscribeAssistant,
} from "@/lib/assistantSession";
import { MailDraftCard } from "./MailDraftCard";
import { useAssistantConversation } from "./AssistantConversationState";
/* SendIcon left with the paper plane (2026-09-03): the send key wears the
   RETURN glyph now, which is the key it duplicates. */
import { DocumentIcon, MicIcon, PlusIcon } from "./icons";
import { mentionedAgent } from "@/lib/agentMention";
import { liveConversation } from "@/lib/liveConversation";
import { SURFACE_TOOLS } from "@/lib/agentSurface";
import { handleClientToolCall } from "@/lib/clientToolRunner";
import { Icon } from "@/components/icons";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { startRecording } from "@/lib/recordingEngine";
import { useAutoGrow } from "@/lib/autoGrow";

/**
 * THREE LINES, THEN IT SCROLLS (user directive, 2026-09-04: "the prompt box
 * does not go to scroll mode after more than 3 lines of text — give it this
 * option and make it a thin scroll bar with fade shape").
 *
 * The first reading of "at least three lines" was a FLOOR with room to grow,
 * so the box climbed to twelve and a dictated paragraph pushed the thread off
 * the screen. Three is the height, in both senses: it opens at three and it
 * stops at three. Everything past that scrolls inside the box, which is what
 * keeps the composer a fixed part of the page instead of something that
 * grows under your hands while you talk.
 */
const PROMPT_ROWS = { min: 3, max: 3 };

type CreateKind = "doc" | "pdf";

/* `StreamDiedError` moved to `assistantSession` with the loop it belongs to
   (2026-09-04). It was declared here and re-declared in the sidebar — two
   spellings of one ending, which is exactly the drift that let one surface
   check for a silent stream death and the other not. */

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
  /*
   * THE THREAD IS NOT THIS COMPONENT'S (user directive, 2026-09-04: "the side
   * bar of ai assistant and its page is basically one … it should be like a
   * mirroring in two different places").
   *
   * `messages`, `streaming` and the session id live in `assistantSession`, a
   * module outside React, and this page is one of two windows onto them. That
   * is what makes a run survive walking away from here: unmounting this
   * component now drops a subscription instead of aborting a fetch, which is
   * what used to CANCEL the answer (closing the SSE body tells the server
   * nobody is listening).
   */
  const live = useSyncExternalStore(subscribeAssistant, assistantSnapshot, assistantServerSnapshot);
  const messages = live.messages;
  /**
   * WHICH conversation's thread the screen currently holds (audit finding,
   * 2026-09-02). `resumeId` alone says which one is WANTED; until the two
   * agree the fetch is in flight, and an empty `messages` in that window is
   * "not here yet", not "nothing was said". The idle hub used to render on
   * `messages.length === 0` alone, so opening a stored conversation showed the
   * welcome line and the suggestion chips for a beat and then swapped them
   * for the thread — the wrong screen assembling itself in front of the
   * reader. Loading and empty are different nothings; this is the flag that
   * keeps them apart.
   */
  const [heldThreadId, setHeldThreadId] = useState<string | null>(null);
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
  /* the handles `@…` can name. Read once and rendered nowhere — the agents
     have no picker on this surface by directive, so the only thing this list
     does is tell a mention from an ordinary at-sign. */
  const [agentHandles, setAgentHandles] = useState<string[]>([]);
  const streaming = live.streaming;
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [model, setModel] = useState<string>("");
  const [skill, setSkill] = useState<string>("");
  /** The SERVER's refusal sentence, when an ask never opened a stream. */
  /* the COMPOSER's own refusals (a file too large, too many attachments) —
     a different fact from a refused run, which the store owns and names in
     the server's words. Rendered through one line below; only one of the two
     can be set at a time, and merging them at the render is honest where a
     second copy of either would not be. */
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
  /* `createOpen` is written and never read since the ⊕ took over the create
     menu (2026-09-03) — the setter stays because the kebab and the sources
     panel still close each other, and a dangling `true` would be a menu that
     nothing can reopen. The value being unread is the honest signal that the
     old trigger is gone. */
  const [, setCreateOpen] = useState(false);
  /** A document format is a visible, removable part of the request — never
   * hidden text placed into the editor on the person's behalf. */
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  /**
   * Meetings attached as context. These ride the ask as `callIds` — the same
   * context mechanic the Echo pane's @mention uses, reached here through
   * Sources → search. The agent still re-checks visibility server-side;
   * attaching is scoping, never authority.
   */
  const [webSearch, setWebSearch] = useState(false);
  /** The skill and model pickers — Sources-style hover menus, not selects. */
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /* the box is the size of what is in it — three lines up to twelve, then
     its own thin scrollbar */
  useAutoGrow(promptRef, input, PROMPT_ROWS);
  const resetVersionRef = useRef(resetVersion);
  const appliedResetVersionRef = useRef(resetVersion);
  /** The mic dictates into the composer (it is NOT Echo's recorder). */
  const dictation = useDictation(locale === "fa" ? "fa-IR" : "en-US", (text) => {
    setInput((v) => (v.trim() === "" ? text : `${v} ${text}`));
    /*
     * THE CARET FOLLOWS THE WORDS (user report, 2026-09-04: "Enter works on
     * the assistant page but in the sidebar assistant it does not").
     *
     * Dictating fills the box without touching focus, so somebody who spoke
     * their question and then pressed Enter was pressing it against the
     * document body — the composer's own handler never ran and nothing
     * happened. Sending is a key on the box, so the box has to have the
     * caret once there is something in it to send.
     */
    promptRef.current?.focus();
  },
  );
  /*
   * HOLD THE HOTKEY, THIS MIC LISTENS (user directive, 2026-09-04: "the key
   * that i want it to be the hotkey for in the setting is the mic in the ai
   * assistant page").
   *
   * The same control the button beside the box presses — not a second path
   * into dictation, which is how a key and a button come to disagree about
   * whether the microphone is open. PRESS starts and RELEASE stops, asked of
   * the recogniser itself (`start`/`stop`, lib/dictation) and never of the
   * rendered status, which lags the truth by a frame and lies for a moment
   * around Chrome's no-speech error — the moment that turned the key into a
   * switch (user, 2026-09-05: "make it push to talk, not push to activate").
   * Priority 2: on this page the strip's own hotkey stands down, so one key
   * opens one microphone.
   */
  usePushToTalk({ onPress: dictation.start, onRelease: dictation.stop, priority: 2 });

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
  /* no AbortController here any more: the run is the store's, and a
     component that could abort it would re-create the defect this change
     exists to fix — a navigation that cancels the answer */
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
  /**
   * `?ask=` PREFILLS THE BOX — it does not send.
   *
   * The Agents screen's "Ask" arrives here with `@roya ` already typed, which
   * is a different thing from `?agent=roya`: that pins the whole conversation
   * to one persona, and this leaves the person to write their question with
   * the mention in it, per turn, the way the user described the feature
   * ("they can come to any assistant conversation and they answer inline").
   *
   * Deliberately not auto-run. A prefilled composer that submits itself is a
   * link that spends a model call, and the one thing the person coming from
   * that screen has not done yet is say what they want.
   */
  const prefill = params.get("ask");
  /* once, and only into an EMPTY box: a person who arrived, started typing and
     then hit a re-render must not have their sentence replaced by the link
     that brought them here */
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefill === null || prefillDone.current) return;
    prefillDone.current = true;
    setInput((prev) => (prev === "" ? prefill : prev));
  }, [prefill]);
  useEffect(() => {
    let alive = true;
    void api.agents()
      .then((rows) => { if (alive) setAgentHandles(rows.map((a) => a.handle)); })
      .catch(() => { /* no roster: an @handle stays plain text and the
                        ordinary assistant answers, which is the right
                        forfeit — the mention is still in the question */ });
    return () => { alive = false; };
  }, []);

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
    /* one call: the thread, the id, and the sidebar handoff are one fact, and
       `adoptAssistantThread` publishes them together — a tick apart and the
       skeleton would flash once more over a thread that had already arrived */
    adoptAssistantThread(id, thread);
    setHeldThreadId(id);
    setFeedback(verdicts);
    setStarted(true);
    void api.shareState(id).then(setShared).catch(() => setShared(false));
  }, [setStarted]);

  useEffect(() => {
    resetVersionRef.current = resetVersion;
  }, [resetVersion]);

  /**
   * CONTINUE WHAT THE SIDEBAR WAS SAYING (user directive, 2026-09-03: "if we
   * go to the assistant page it will be continue there").
   *
   * `?c=` still wins — a link to a specific conversation is a more explicit
   * statement than "whatever was open" — and this only fills the gap where
   * nothing was named: arriving at /assistant from the rail while a
   * conversation is live in the sidebar.
   *
   * The read is ONCE, on mount, not a subscription. This page owns the
   * conversation while somebody is on it; re-adopting mid-session would let a
   * background write yank the thread out from under a reader.
   */
  const handedOver = useRef<string | null | undefined>(undefined);
  if (handedOver.current === undefined) handedOver.current = liveConversation();
  const continueId = resumeId ?? handedOver.current;

  useEffect(() => {
    if (!continueId) return;
    /*
     * ALREADY HOLDING IT = NOTHING TO LOAD (2026-09-04).
     *
     * With one shared conversation, arriving here often means arriving at a
     * thread that is already in memory — the person walked over from the
     * sidebar, possibly mid-answer. Refetching then is not merely wasteful:
     * it REPLACES a live thread with the stored rows, and the stored rows are
     * not the same thing. A run still streaming has written nothing yet; a
     * fetch that comes back short (a purge, an older deployment, a partial
     * answer that failed and was never persisted) silently shortens the
     * conversation the person is reading.
     *
     * Caught by the mirroring test with an empty fixture: the answer arrived,
     * the page remounted, and the question vanished from under it.
     */
    const held = assistantSnapshot();
    if (held.sessionId === continueId && held.messages.length > 0) {
      setHeldThreadId(continueId);
      setStarted(true);
      void refreshDrafts(continueId);
      return;
    }
    /* a freshly opened thread shows its LATEST turn — re-pin here, not in
       adoptThread: adoptThread also runs after every `done`, where re-pinning
       would yank a reader who scrolled up mid-answer */
    pinnedRef.current = true;
    let cancelled = false;
    void adoptThread(continueId).then(() => {
      if (cancelled) return;
      /* a resumed conversation shows its drafts again: the card is the only
         place the reply can be sent from inside the product, so coming back
         to the thread has to bring it back too */
      void refreshDrafts(continueId);
    }).catch(() => {
      /* audit finding, 2026-09-02: the skeleton stands for a request IN
         FLIGHT, never for a refusal — a fetch that fails settles too, or the
         screen would load forever. What renders then is what rendered before
         this flag existed (the idle hub); the refusal has no sentence of its
         own on this screen yet, and that gap is named here rather than hidden
         behind a skeleton that never ends. */
      if (!cancelled) setHeldThreadId(continueId);
    });
    return () => {
      cancelled = true;
    };
  }, [continueId, adoptThread, refreshDrafts]);

  useEffect(() => {
    if (resetVersion === 0 || appliedResetVersionRef.current === resetVersion) return;
    appliedResetVersionRef.current = resetVersion;
    /* Starting fresh also stops a live response. Otherwise its completion
       could put content back into the just-cleared hub. */
    /* Starting fresh also stops a live response and clears the handoff — the
       store does both, or the sidebar would pick up the conversation this
       button just cleared: a "new conversation" that follows you back into
       the platform as the old one. */
    resetAssistantSession();
    pinnedRef.current = true;
    setHeldThreadId(null);
    setInput("");
    setFeedback({});
    setShared(false);
    setAttachments([]);
    setCreateKind(null);
    setWebSearch(false);
    setAskError(null);
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
  /* a wanted conversation the screen does not hold yet — see heldThreadId;
     `idle` is still true in this window, which is exactly why it cannot be
     the thing that decides between the welcome screen and a skeleton */
  const loadingThread = resumeId !== null && heldThreadId !== resumeId;

  /* the dashboard LEFT this component (user directive, 2026-08-25): it is
     the landing PAGE now (components/platform/Dashboard.tsx), not a view of
     the hub — a briefing and a conversation are different screens */

  /**
   * THE HANDS THIS PAGE LENDS A RUN.
   *
   * The run belongs to the store and outlives this component; what cannot
   * outlive it is the ability to navigate, switch locale, and refetch the
   * persisted rows. So they are REGISTERED while mounted rather than captured
   * when the ask starts — a run that began here and finished after you walked
   * to /meetings performs its client tools with the sidebar's hands, which is
   * the correct answer to "whose browser is this".
   *
   * The reducer itself — deltas, tool calls, a colleague's turn, the
   * stream-died check — moved to `assistantSession` whole. It had been written
   * TWICE, once here and once in the sidebar, and the two had already drifted:
   * only one of them handled `client_tool_call`, which is how a recording
   * asked for on this page hung until the 120-second timeout.
   */
  useEffect(() => registerAssistantSurface({
    handleClientTool: (event) => handleClientToolCall(event, {
      /* no consent card on this surface yet, so write-effect tools are NOT
         offered a silent yes — `askConsent` is absent, which the runner reads
         as "this surface cannot ask", and the server's own `requires_consent`
         still governs what it sends */
      push: router.push,
      switchLocale: (next) => router.replace("/assistant", { locale: next }),
    }),
    onSettled: (reason) => {
      const id = assistantSnapshot().sessionId;
      if (!id) return;
      /*
       * NOT AFTER A FAILURE, and this is the one branch worth stating.
       *
       * A clean finish and a stop both leave the server holding the truth —
       * the toolbar needs its ids, and the Shape-A/B rules decide what an
       * interrupted run persisted, so refetching is right. A FAILED run does
       * not: the partial answer that arrived is on screen and is not in the
       * database, so adopting the stored rows would erase exactly the
       * evidence the annotation is pointing at. The person would watch their
       * half-answer disappear and be told it was cut off.
       */
      if (reason === "failed") return;
      void adoptThread(id).catch(() => undefined);
      if (reason === "done") void refreshDrafts(id);
    },
  }), [router, adoptThread, refreshDrafts]);

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

    await askAssistant({
      question,
      page: "hub",
      /* client-only tag: when this answer lands, the toolbar offers the
         promised deliverable (Save as PDF / download) — the Create chip used
         to only PREFIX the prompt, and the person got prose with no file
         (user report, 2026-08-20) */
      ...(createKind ? { created: createKind } : {}),
      options: {
          model: model || undefined,
          skill: skill || undefined,
          /* `?agent=` pins the conversation; an `@handle` in THIS message
             routes just this turn — and the message wins, because it is the
             more recent and more specific thing the person said */
          agent: mentionedAgent(question, agentHandles)?.handle ?? agentHandle ?? undefined,
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
      },
    });
  }

  async function regenerate() {
    await regenerateAssistant({ model: model || undefined, locale });
  }

  function stop() {
    stopAssistant();
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
    if (!live.sessionId) return;
    setShared(await api.setShared(live.sessionId, !shared));
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

  /*
   * THE TOOLBAR'S OWN IDIOM, not a fifth button shape (audit finding,
   * 2026-09-02). This const used to spell a 32px rounded-full lozenge with
   * 11.5px text — a pill on a BUTTON, which the radii rule forbids — and it
   * dressed five controls on a screen whose toolbar, one row up, is 34px
   * `.btn-sm` rectangles: two button families stacked on one page, the "ten
   * developers" symptom exactly. The control guard could not see it because
   * the classes lived in a const rather than a className literal. The string
   * is now AssistantMenu's, verbatim, so the two rows read as one toolbar.
   */
  const headerBtn = "btn btn-sm gap-1.5 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg";
  /* the PRESSED state (Share is a toggle): the soft accent the listening mic
     already wears. Not `border-accent` — `.btn-sm` draws no border, so that
     class would be present, read as satisfied, and paint nothing. */
  const headerBtnOn = "btn btn-sm gap-1.5 font-medium bg-accent-soft text-accent";

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
      /* WIDTH, GUTTERS AND RHYTHM ARE THE PAGE'S NOW (2026-09-02): the
         assistant page renders this inside PageContainer, which owns the
         column and the padding. Two earlier notes here — the table-width
         cap and the sticky-composer bottom — described classes this root
         no longer carries; the bottom lives on the container as a stated
         override for the same sticky-composer reason. */
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
      /*
       * THE SMALL COLUMN, AND THE PAGE DOES NOT SCROLL (user directive,
       * 2026-09-02: "the AI assistant must become the small page as well, and
       * not scroll mode — it should be fixed, and the scroll is inside its
       * text and conversation").
       *
       * The small column is the PAGE's now — `<PageContainer width="small">`
       * in assistant/page.tsx (audit finding, 2026-09-02) — and the reason
       * travelled with it: a conversation is reading width, and a thread
       * stretched across a list column makes every line a journey. This
       * paragraph used to name `max-w-content-small` as a class on this root,
       * and kept saying so after the class left; a comment that describes a
       * class the line under it does not carry is the kind a reader trusts.
       *
       * `h-full overflow-hidden` on BOTH states, not only the active one. The
       * idle hub grew with its suggestions and the page scrolled behind a
       * composer pinned to its foot — so the one screen whose whole job is a
       * fixed box with a fixed prompt was the one that moved. The thread's own
       * scroller (below) is the only thing that scrolls, and it wears
       * `scroll-quiet`, which is the thin bar this platform uses everywhere.
       */
      /* NO COLUMN OF ITS OWN any more (audit finding, 2026-09-02): the
         assistant page renders this inside <PageContainer width="small">
         like every other surface, so the column, the gutters and the top
         padding are the container's. Drawing them here as well put the
         toolbar and the content in two different columns. */
      className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      {/*
        the conversation's own actions — Share and Export, once there is a
        persisted conversation to share or export.

        THE HISTORY LINK LEFT THIS ROW (audit finding, 2026-09-02): the page
        mounts <AssistantMenu> directly above this component, and that toolbar
        already carries the door to /conversations as a `.btn-sm`. Keeping a
        second one here put two toolbars back to back with two History doors
        — a leftover from when the menu was a side pane. The meetings and
        tasks pages have exactly one toolbar row and never repeat a
        destination. The row now renders only when it has something in it:
        an empty `mb-4` div under a first live ask was 16px of dead space.
      */}
      {!idle && live.sessionId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={shared ? headerBtnOn : headerBtn}
            aria-pressed={shared}
            onClick={() => void toggleShare()}
          >
            {shared ? t("sharedWithOrg") : t("share")}
          </button>
          <button type="button" className={headerBtn} onClick={exportMarkdown}>
            {t("exportMd")}
          </button>
        </div>
      ) : null}

      {/*
        THE AGENT PANEL IS GONE (user directive, 2026-09-03: the agents must
        not "come to the AI assistant like a window or options any more").
        What stood here was an agent's overview — its workflows, its reach,
        and an arranging UI — unfolding above the thread whenever `?agent=`
        was set. The agents have their own surface now (db/0164, /agents),
        where they answer in a room instead of decorating this one.

        The `agent` PARAM still rides the ask below: it picks whose persona
        answers, which is a fact about the run and not a window on this
        screen, and `record_on_agents` (db/0142) arms a take off the same
        handle. Only the panel went.
      */}

      {loadingThread ? (
        /* audit finding, 2026-09-02: a stored conversation being opened shows
           the THREAD's shape while its rows are on the way — the same box the
           thread will scroll in, filled with skeleton lines — never the
           welcome screen. The frame is structure and structure is known
           before the network; only the words wait. */
        <div className="scroll-quiet fade-scroll mb-4 min-h-0 flex-1 overflow-y-auto" aria-busy="true">
          <SkeletonLines lines={6} className="mt-2" />
        </div>
      ) : idle ? (
        /* min-h-0 so this half can shrink inside the fixed page, and its own
           scroller carries the overflow rather than the document */
        /* justify-START, not end (user directive, 2026-09-02: "put the
           suggestions up as well, under the first welcoming message from the
           AI itself"). The suggestions used to hug the composer at the foot,
           where they read as a toolbar attached to the input; under an
           opening line from the assistant they read as things you might say
           back, which is what they are. */
        <div className="scroll-quiet fade-scroll flex min-h-0 flex-1 flex-col justify-start overflow-y-auto">
          {/*
            THE ASSISTANT SPEAKS FIRST — and this is a GREETING, not a
            message: it is never persisted, never given a role, and never
            joins the thread. The rule the platform already carries about
            failure annotations applies here for the same reason — a
            synthetic line that can be mistaken for something the assistant
            actually said is a lie on a delay, so this one lives only on the
            empty screen and disappears the moment a real turn exists.
          */}
          {!workflowSlug ? (
            <p className="message-arrives mx-auto mt-2 w-full max-w-content text-sm leading-7 text-fg">
              {t("hubWelcome")}
            </p>
          ) : null}
          {/* THE WATERMARK IS GONE (user directive, 2026-09-02: "also remove
                the background"). A brand mark behind the one screen whose
                job is a blank prompt is decoration competing with an empty
                box — and at 3.5% it was visible enough to notice and too
                faint to read, which is the worst of both. */}
          {/* the picked-agent chip that lived here became the agent
              overview panel, and that went with the agents surface on
              2026-09-03 — the agents answer in a room now (db/0164) */}
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
          {!workflowSlug && suggestions.length > 0 ? (
            <div className="mx-auto mt-3 flex w-full max-w-content flex-wrap justify-start gap-2">
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
        </div>
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
          /*
           * THE BAR SITS AT THE COLUMN'S EDGE, not inside it (user directive,
           * 2026-09-04: "position this scroll in the same place as the scroll
           * of the page, with the exceptional function that it just moves the
           * chatbox up and down, the page is fixed").
           *
           * The scroller lives inside `PageContainer`, which pads the column,
           * so its bar was drawn 28px in from the edge — a thin line floating
           * in dark space with nothing beside it, which reads as a stray
           * element rather than as this region's scrollbar. The negative
           * inline margin pulls the SCROLLING BOX out to the column's true
           * edge, exactly where the page's own bar would be, and the padding
           * goes back on the content so the words do not move at all.
           *
           * LOGICAL, not physical: a browser draws the scrollbar on the
           * inline-end side, which is the LEFT in Persian. `-mx` puts the box
           * flush on both, so the bar lands correctly in either direction
           * without this file knowing which one it is in.
           *
           * The page stays fixed by construction — the shell is `h-dvh` and
           * this is the one region with `overflow-y-auto`, so there is nothing
           * else that could move.
           */
          className="scroll-quiet fade-scroll -mx-page-inline mb-4 min-h-0 flex-1 overflow-y-auto px-page-inline md:-mx-page-inline-md md:px-page-inline-md"
        >
          <ConversationThread
            messages={messages}
            streaming={streaming}
            feedback={feedback}
            onFeedback={(id, verdict) => void judge(id, verdict)}
            onRegenerate={() => void regenerate()}
          />
          {/* the composer's own refusal, or the run's — the run's words are
              the SERVER's when it gave any, and this page's translated line
              when it did not (a store has no locale and must not write copy) */}
          {askError !== null || live.error !== null ? (
            <p role="alert" className="mt-2 text-xs leading-6 text-danger">
              {askError ?? live.error?.detail ?? t("askFailed")}
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
        className={`flex w-full max-w-content flex-col rounded-2xl border border-border-strong bg-surface px-3 pb-0.5 pt-3 text-start transition-colors focus-within:border-accent ${
          idle ? "mx-auto mt-auto" : "sticky bottom-0 mx-auto"
        }`}
      >
        {/*
          THE FIELD ON ITS OWN LINE, THE CONTROLS UNDER IT — and the controls
          sit in FIXED PHYSICAL CORNERS (user directive, 2026-09-03: "put it in
          right down corner in both fa and en version ... the plus and mic
          together in left down corner").

          `dir="ltr"` on the control row is the whole mechanism, and it is a
          deliberate exception to this codebase's logical-properties rule. Every
          other row here follows the page so it mirrors in English; this one
          must NOT. A send key that swaps corners with the interface language is
          a key that has to be found again after every switch — the same
          argument the time picker settled a few hours earlier, where the panel
          was pinned to match the `HH:mm` it edits.

          So: mic and ⊕ at the physical left, send at the physical right, in
          both locales. The TEXT inside the field is untouched — it follows the
          page, as prose must.
        */}
        {/*
          A TEXTAREA, THREE LINES TALL (user directive, 2026-09-04: "the
          prompt box must be multi-line and should get as much as I gave it,
          and show at least three lines then go to scroll mode inside it with
          a thin scroll").

          It was an `<input>` — one line by construction, no wrapping at all —
          so a dictated paragraph scrolled off sideways and the person could
          read the last few words of their own sentence. `useAutoGrow` takes it
          from three lines to twelve and hands the rest to the box's own
          scrollbar, which is `scroll-quiet`: the platform's 6px bar, not a new
          one invented here.

          `resize-none` because the corner grip would fight the measurement —
          a person's dragged height is overwritten by the next keystroke, which
          is a control that works once.
        */}
        <textarea
          ref={promptRef}
          rows={PROMPT_ROWS.min}
          className="scroll-quiet fade-scroll-tight w-full resize-none bg-transparent text-sm leading-6 text-fg outline-none placeholder:text-fg-muted focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder={t("promptPlaceholder")}
          aria-label={t("promptPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            /*
             * ENTER SENDS, SHIFT+ENTER BREAKS THE LINE — and `isComposing`
             * guards the one case where that is wrong: an IME is mid-word and
             * Enter is choosing a candidate, not finishing a thought.
             */
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape" && streaming) stop();
          }}
        />
        {/*
          THE CONTROLS SIT LOW (user directive, 2026-09-04: "make the items
          icons of the enter and plus and mic 10% above the bottom level of the
          prompt box, they are too high in it").

          The row was `mt-1.5` under the field, which put it wherever the field
          happened to end — floating inside a box padded 12px on every side.

          Asked TWICE (2026-09-04, with a before/after pair): the first answer
          cut the pad to 8px, which was still too high. It is 2px now, and the
          gap under the glyphs is the icon button's own — `.btn-icon` is 28px
          around a 16px glyph, so six of the ten pixels beneath a mic are
          inside its hit area and cannot be taken away without shrinking the
          target. That is the floor, and it is worth saying because the next
          person asked to move them "down a bit more" needs to know the
          remaining space is a 44px-hit-area promise rather than padding.

          `mt-auto` takes any slack when the box is stretched (the idle hub
          centres it in the column); `pt-3` above the field is untouched.
        */}
        <div className="mt-auto flex items-center justify-between pt-0.5" dir="ltr">
          <span className="flex items-center gap-1">
            <button
              type="button"
              className={`btn btn-icon shrink-0 ${micTone(dictation.status)}`}
              title={dictation.status === "listening" ? t("voiceListening") : t("voice")}
              aria-pressed={dictation.status === "listening"}
              onClick={dictation.toggle}
            >
              <MicIcon width={16} height={16} />
            </button>
            <ComposerActions
              connectorsLabel={t("connectors")}
              manageLabel={t("manageConnectors")}
              createLabel={t("create")}
              sourcesLabel={t("sources")}
              docLabel={t("createDoc")}
              pdfLabel={t("createPdf")}
              menuLabel={t("composerMenu")}
              attachFileLabel={t("sourcesAttach")}
              webSearchLabel={t("sourcesWeb")}
              webSearch={webSearch}
              onCreate={(kind) => { setCreateKind(kind); setCreateOpen(false); }}
              onAttachFile={() => fileRef.current?.click()}
              onToggleWeb={() => setWebSearch((v) => !v)}
              onManageConnectors={() => router.push("/settings/integrations")}
            />
          </span>
          {streaming ? (
            /* send morphs into STOP — one button, one place, per the donor's
               composer; Esc does the same from the keyboard */
            <button
              type="button"
              className="btn btn-icon shrink-0 bg-surface-2 text-fg"
              title={t("stop")}
              onClick={stop}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
          ) : (
            <button
              type="button"
              /* NO FILL (user directive, 2026-09-03). A solid accent square in
                 a composer whose one other accent is the workspace's primary
                 action makes neither of them mean "this is the main thing" —
                 the same call the sidebar's send key took. `disabled:opacity`
                 is what says the box is empty. */
              className="btn btn-icon shrink-0 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
              /*
                IT SAYS WHEN IT CANNOT SEND (user report, 2026-09-04: "the
                enter key is not working for sending the prompt").

                `send()` returns silently while a run is streaming — correct,
                since two questions on one thread would interleave — but this
                button was disabled only on an EMPTY box, so during a run it
                looked live, took the press and did nothing. Enter did the
                same. After a turn that ended badly the composer was simply
                dead, with nothing on screen to say so and nothing to press to
                recover.

                The panel already solved this: while streaming the key becomes
                the way to STOP. Same here now, so the state is visible and the
                way out is the control already under the pointer.
              */
              title={streaming ? t("stop") : t("send")}
              aria-label={streaming ? t("stop") : t("send")}
              disabled={!streaming && input.trim() === ""}
              onClick={() => { if (streaming) stop(); else void send(); }}
            >
              {/* the RETURN key's own glyph, not a paper plane: the button and
                  the Enter shortcut it duplicates stop being two unrelated
                  facts a person has to learn separately */}
              <Icon name={streaming ? "pause" : "enter"} size="sm" />
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
          {/* CREATE — choosing a format makes it a visible chip beside the
              real request. It never pre-fills the editor. */}
          {createKind ? (
            /* `.chip`, the same spelling as the context and attachment chips a
               few lines up (audit finding, 2026-09-02): this one had copied
               `headerBtn`'s 32px geometry, so one composer showed two chip
               heights. Its × is the sibling chips' × too. */
            <span className="chip bg-accent-soft text-xs text-accent">
              <DocumentIcon width={14} height={14} />
              {createKind === "doc" ? t("createDoc") : t("createPdf")}
              <button
                type="button"
                className="ms-1 text-accent/70 hover:text-accent"
                aria-label={t("removeCreate", { name: createKind === "doc" ? t("createDoc") : t("createPdf") })}
                onClick={() => setCreateKind(null)}
              >
                ×
              </button>
            </span>
          ) : null}
          {/* the CREATE menu's own trigger is gone (2026-09-03): the composer's
              ⊕ opens it now, so a second button beside the field would be two
              doors to one room. The chip above still shows the chosen format. */}

          {/*
            THE MEETING SEARCH IS GONE (user directive, 2026-09-04: "remove the
            search in source"), and the panel went with it rather than staying
            behind as a room with no door. It was the only opener; `attachCall`,
            the debounced search and the attached-meeting chips were the only
            things it fed, so they are gone too. A producer with no consumer is
            a defect its author cannot see — and this one would have been an
            entire panel, its state, and a network call on every keystroke into
            a field nobody could reach.

            The `call_ids` WIRE is untouched: the ask still carries context
            calls, there is simply no producer for them on this surface at the
            moment. That is a smaller thing than a panel, and it is where a
            future "ask about this meeting" would arrive.
          */}
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
/* `HoverMenu` left with the sources panel (2026-09-04) — it was written for
   that one panel and had exactly one consumer, so keeping it would have been a
   component nothing renders waiting to be rediscovered and reused for
   something it was not shaped for. */

/**
 * THE COMPOSER'S ⊕ (user directive, 2026-09-03: "in the plus make a kebab menu
 * with connectors, create and source in it, make the text of the kebab menu
 * small and the size of their icon and tabs as small as possible").
 *
 * Three text buttons under the field became one glyph beside it. What they
 * were — «ساخت», «منابع» — are the same acts; what changed is that a composer
 * whose job is a sentence stopped carrying a second toolbar underneath it.
 *
 * «اتصال‌ها» joins them because it belongs to the same question. Create,
 * sources and connectors are all "what should this answer be built from", and
 * the third one was only ever reachable from a settings page.
 *
 * SMALL, deliberately: `text-xs` rows, `w-52`, tight padding. It is a list of
 * three things beside a field, not a section — the sidebar's own composer menu
 * settled the same measurements a few hours earlier, and two menus doing one
 * job at two sizes is the drift this file has been paying off all day.
 *
 * The connector list is READ (`api.connectors()`), never a hand-written list
 * of providers — that would be a second claim about what the product supports,
 * and the first thing to rot the day one is added.
 */
function ComposerActions({
  connectorsLabel, manageLabel, createLabel, sourcesLabel,
  docLabel, pdfLabel, menuLabel, attachFileLabel,
  webSearchLabel, webSearch,
  onCreate, onAttachFile, onToggleWeb, onManageConnectors,
}: {
  connectorsLabel: string;
  manageLabel: string;
  createLabel: string;
  sourcesLabel: string;
  docLabel: string;
  pdfLabel: string;
  menuLabel: string;
  attachFileLabel: string;
  webSearchLabel: string;
  webSearch: boolean;
  onCreate: (kind: "doc" | "pdf") => void;
  onAttachFile: () => void;
  onToggleWeb: () => void;
  onManageConnectors: () => void;
}) {
  const [connectors, setConnectors] = useState<ConnectorStatus[] | "failed" | null>(null);

  /* read when the menu OPENS, not on mount: this composer renders on every
     visit to the assistant, and a connectors request per visit for a menu
     nobody opened is a request nobody asked for */
  const load = () => {
    if (connectors !== null) return;
    void api.connectors().then(setConnectors).catch(() => setConnectors("failed"));
  };

  /* small, and the same measurements the sidebar's composer menu settled:
     three things beside a field, not a section */
  const item = "gap-2 px-2 py-1 text-xs";
  const panel = "min-w-0 p-0.5";
  /*
   * FORTY PER CENT NARROWER (user directive, 2026-09-04: "make the length of
   * the menu of the plus 40% less than what it is now").
   *
   * Written as the arithmetic rather than as the answer, because the answer is
   * the part that stops being checkable: 13rem was chosen for a menu whose
   * longest row is «اتصال‌ها», and 13 × 0.6 = 7.8 is a sentence somebody can
   * verify against the directive a month from now. `w-32` would be 8rem and
   * near enough, and near enough is how a measured value becomes folklore.
   */
  const menuW = "w-[7.8rem]";      // 13rem − 40%
  const subW = "w-[8.4rem]";       // 14rem − 40%, the wider submenus
  const subNarrowW = "w-[6.6rem]"; // 11rem − 40%, Create's two rows
  return (
    <DropdownMenu onOpenChange={(next) => { if (next) load(); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="btn btn-icon shrink-0 text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={menuLabel}
          title={menuLabel}
        >
          <PlusIcon width={16} height={16} />
        </button>
      </DropdownMenuTrigger>
      {/*
        EVERY ROW CARRIES ITS ICON (user directive, 2026-09-03: "all must have
        icons as well"). A menu of three submenus is read by shape before it is
        read by word — and these three answer genuinely different questions
        (make something, attach something, reach something), so the glyph is
        doing work rather than decorating.
      */}
      <DropdownMenuContent side="top" align="start" className={`${menuW} ${panel}`}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <DocumentIcon width={13} height={13} />
            {createLabel}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={`${subNarrowW} ${panel}`}>
            <DropdownMenuItem className={item} onSelect={() => onCreate("doc")}>
              <Icon name="fileText" size="sm" />
              {docLabel}
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={() => onCreate("pdf")}>
              <Icon name="download" size="sm" />
              {pdfLabel}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/*
          SOURCES IS A SUBMENU NOW, not a row that opened a second panel. It
          had stayed a plain item pointing at the old hover-panel, which left
          «منابع» drawn twice — once in here and once as a leftover button
          under the field. Its three ACTS are what belong in a menu; the
          meeting SEARCH still opens the rich panel, because a search field
          inside a dropdown is a worse place to type than the panel built for
          it.
        */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <Icon name="tag" size="sm" />
            {sourcesLabel}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={`${subW} ${panel}`}>
            <DropdownMenuItem className={item} onSelect={onAttachFile}>
              <Icon name="fileText" size="sm" />
              {attachFileLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={item} onSelect={(e) => { e.preventDefault(); onToggleWeb(); }}>
              <Icon name="globe" size="sm" />
              {webSearchLabel}
              {/* the STATE, not a switch: a toggle inside a menu row is two
                  hit targets in one line, and the check says the same thing */}
              {webSearch ? <Icon name="check" size="sm" className="ms-auto text-accent" /> : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <Icon name="plug" size="sm" />
            {connectorsLabel}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={`${subW} ${panel}`}>
            {connectors === null ? (
              <div className="px-2 py-1"><SkeletonLines lines={2} /></div>
            ) : connectors === "failed" ? (
              <DropdownMenuItem className={item} disabled>{connectorsLabel}</DropdownMenuItem>
            ) : (
              connectors.map((row) => (
                <DropdownMenuItem key={row.provider} className={item} onSelect={onManageConnectors}>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      row.status === "connected" ? "bg-accent" : "bg-fg-subtle"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{row.account_label ?? row.provider}</span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className={item} onSelect={onManageConnectors}>
              <Icon name="settings" size="sm" />
              {manageLabel}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
