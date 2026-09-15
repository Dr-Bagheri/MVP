"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/api/client";
import type { ConnectorProvider, MailDraft, SearchHit, Skill, WorkflowCard } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { SkeletonLines } from "@/components/scaffold";
/* the picker's date goes through the platform's own formatter, so a record's
   date reads in the reader's calendar and digits rather than in the wire's */
import { formatDate } from "@/lib/format";
import { micTone, useDictation } from "@/lib/dictation";
import { usePushToTalk } from "@/lib/usePushToTalk";
import { subscribeComposer, takePendingDraft } from "@/lib/assistantBus";
import { useThreadFollow } from "@/lib/threadFollow";
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
import { MicIcon } from "./icons";
import { FloorChip } from "./FloorChip";
import { liveConversation } from "@/lib/liveConversation";
import { SURFACE_TOOLS } from "@/lib/agentSurface";
import { handleClientToolCall, type ConsentAnswer } from "@/lib/clientToolRunner";
import {
  consentGrantServer, consentGrantedForSession, revokeSessionConsent, sessionGrantEligible, subscribeConsentGrant,
} from "@/lib/consentGrant";
import { Icon } from "@/components/icons";
import { startRecording } from "@/lib/recordingEngine";
import { useAutoGrow } from "@/lib/autoGrow";
import { notifyError } from "@/lib/notify";

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

/**
 * ATTACHMENTS AND CALLS ARE THE COMPOSER'S TWO ACTS.
 *
 * What left was a ⊕ opening three submenus — Create (Doc/PDF), Sources
 * (attach / search the web) and Connectors — and what replaced it is a single
 * paperclip that opens the file picker on the FIRST press. The directive named
 * the shape and the reason is the one the composer has been converging on all
 * week: a box whose job is a sentence should not carry a menu of decisions to
 * make before typing it.
 *
 * Create is DELETED, not hidden: its state, its two prompt prefixes, its chip
 * and the auto-download effect are gone. The `created` tag still travels on the
 * wire and `ConversationThread` still draws the Save-as-PDF / download button
 * for any stored answer that carries one, so conversations made before today
 * keep their file — what left is the producer, which is what "no create
 * feature" names.
 *
 * Connectors left the composer with the menu that held them. They are not lost:
 * the sidebar composer's own menu still lists them and `/integrations` is the
 * page. Web search left with Sources — see `send()` for the one line that
 * changed on the wire.
 */

const ATTACH_MAX_BYTES = 50_000;
const ATTACH_MAX_COUNT = 3;
/** how long the mention picker waits after a keystroke before it asks the index */
const MENTION_DEBOUNCE_MS = 200;
/** the index refuses a shorter query (api.search returns [] below this) */
const MENTION_MIN_QUERY = 2;
/** a picker is a glance, not a page */
const MENTION_SHOWN = 6;

/** a call attached as context: the id rides the ask, the title is what a person reads */
type ContextCall = { id: string; title: string };

/**
 * THE `@` IS A CALL.
 *
 * The caret's own text is what decides, exactly as the room's mention picker
 * decides: the run of characters between a `@` at a word boundary and the
 * caret. Anything else — a `@` in the middle of an address, a `@` three words
 * back that the person typed past — is not a mention being written.
 *
 * Exported for its test: this is the one piece of the feature with edges
 * (a bare `@`, an email, a mention already finished) and no DOM.
 */
export function mentionQuery(value: string, caret: number): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
  /* written as a statement, not `match === null ? null :` — that spelling is
     what `loading.guard` counts as a section vanishing instead of framing
     itself, and a file with no entry on its worklist must not grow one for a
     line that is not a loading state at all */
  if (match === null) return null;
  return match[1]!;
}

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
export function Hub({ idleContent }: { idleContent?: ReactNode } = {}) {
  const t = useTranslations("platform");
  const tPresence = useTranslations("presence");
  /* the consent card, the same one the strip draws (2026-09-06: this page
     had none, and the runner performed every write asked for here on a
     silent yes — the runner refuses that now, and this is how the page asks) */
  const [consent, setConsent] = useState<
    | null
    | { label: string; detail: string | null; tool: string; resolve: (answer: ConsentAnswer) => void }
  >(null);
  /* the standing yes, drawn while it is on so it can be taken back from where
     it is seen (lib/consentGrant.ts) */
  const sessionGrant = useSyncExternalStore(subscribeConsentGrant, consentGrantedForSession, consentGrantServer);
  /* the pending card's answer, held so an unmount or a fresh conversation can
     answer «نه» for a person who is no longer looking at it (2026-09-06) */
  const consentRef = useRef<((answer: ConsentAnswer) => void) | null>(null);
  
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
  const streaming = live.streaming;
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<Skill[]>([]);
  const [model, setModel] = useState<string>("");
  const [skill, setSkill] = useState<string>("");
  /*
   * THE RUN'S REFUSAL, SAID ONCE (2026-09-08).
   *
   * Two different facts used to share one red line under the composer: this
   * page's own refusals (a file too large, too many attachments) and the
   * STORE's — the server's sentence when an ask never opened a stream. The
   * composer's are toasts at the point they happen; the store's is a value
   * that sits in a snapshot until the next ask clears it, so it is raised on
   * the EDGE rather than on every render that reads it.
   *
   * The server's own words win when it gave any: a store has no locale and
   * must not write copy, and this page's translated line is the fallback for
   * a transport failure that produced no sentence at all.
   */
  const prevRunError = useRef(live.error);
  useEffect(() => {
    if (live.error !== null && live.error !== prevRunError.current) {
      notifyError(live.error.detail ?? t("askFailed"));
    }
    prevRunError.current = live.error;
  }, [live.error, t]);

  /**
   * Attached files (user directive: "add files and ask about them"). Text
   * files only, read CLIENT-side and sent as part of the question — the ask
   * wire is text, so this needs no new backend and the record shows exactly
   * what the model saw. Binary and oversized files are refused with a
   * sentence, never silently dropped.
   */
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([]);
  /**
   * THE SAME LIST, READABLE THIS INSTANT — and it is not a second source of
   * truth, it is the one the writer reads.
   *
   * Three files dropped together are three passes through `attach`, each one
   * awaiting `file.text()`, and React does not run a state updater until it
   * renders: `attachments` is the list as it was when the drop began, and a
   * ceiling checked against it lets all three past a limit of three. Reading
   * `prev` inside the setter sees the right list but answers a frame too late
   * for the loop that has to decide whether to say so.
   *
   * So every write goes through `stageFiles`, which moves the ref and the
   * state together. A caller that reaches for `setAttachments` directly is the
   * bug this exists to prevent.
   */
  const stagedRef = useRef<{ name: string; text: string }[]>([]);
  const stageFiles = useCallback((next: { name: string; text: string }[]) => {
    stagedRef.current = next;
    setAttachments(next);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * DRAGGING A FILE ONTO THE BOX ATTACHES IT.
   *
   * Native `dragover`/`drop`, and that is NOT a breach of R17's ban on
   * `draggable`: R17 governs dragging an ELEMENT of ours, where a native
   * `dragstart` fires from the nearest draggable ancestor and eats the
   * pointer gesture `holdDrag` is built on. A file arriving from the operating
   * system has no element and no gesture of ours — the drop event is the only
   * way the browser will ever hand it over.
   *
   * The counter, not a boolean: `dragenter`/`dragleave` fire for every child
   * the pointer crosses, so a flag set on enter and cleared on leave goes dark
   * the moment the cursor passes over the textarea inside the panel — the
   * highlight flickering while the file is still held is exactly the state
   * this is meant to make legible.
   */
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  /**
   * CALLS ATTACHED AS CONTEXT, reached by typing `@` in the box.
   *
   * These ride the ask as `callIds` — a wire that has been live and tested
   * with no producer since the Sources search was removed on 2026-09-04, and
   * whose own tombstone in this file named this as where its next producer
   * would arrive. The agent still re-checks visibility server-side; attaching
   * is SCOPING, never authority.
   */
  const [contextCalls, setContextCalls] = useState<ContextCall[]>([]);
  /** the run of text after the `@` being typed, or null when none is */
  const [mention, setMention] = useState<string | null>(null);
  const [mentionHits, setMentionHits] = useState<SearchHit[] | "searching">("searching");
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
  /**
   * AUTO-FOLLOW — lib/threadFollow, ONE mechanism for every thread on the
   * platform (2026-09-06). The box gets the ref and the scroll handler, its
   * one content wrapper gets the other ref, and the person's own acts call
   * `repin`. While the reader is at (or near) the bottom, every size change
   * in the box keeps the newest line in view — a delta, a colleague's second
   * answer, the consent card, the refusal line, the composer growing under
   * it. When they have scrolled UP to re-read something older, nothing moves
   * them: that is the difference between following and fighting. They
   * re-pin by returning to the bottom (the handler notices) or by sending.
   *
   * Until this day the follow here ran on the MESSAGE LIST alone, so a card
   * or a refusal — which are not messages — landed below the fold and stayed
   * there until the person scrolled ("the messages from agents or echo go
   * under the field of vision"). `followPage`: below md the page scrolls
   * rather than this box, and the follow reaches it there.
   */
  const follow = useThreadFollow({ followPage: true });

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
      pathname: "/",
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
        /* the PANE, not the address that redirects into it (2026-09-08):
           a shortcut that costs a round trip is a slower shortcut */
        router.push({ pathname: "/", query: { view: "agents" } } as never);
      } else if (event.ctrlKey && event.shiftKey && event.code === "KeyI") {
        event.preventDefault();
        router.push({ pathname: "/", query: { view: "workflows" } } as never);
      } else if (event.key === "/" && !inField && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        promptRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  /**
   * ATTACH A LIST, NOT A FILE - a drop and a multi-select both arrive as
   * several, and the single-file version silently kept the first one.
   *
   * The count is read from the SETTER's `prev`, never from the rendered
   * `attachments`: three files dropped together are three calls against one
   * stale closure, so a guard on the rendered array would let all three past a
   * ceiling of three. Each refusal keeps its own sentence - a drop that
   * quietly loses the fourth file is the same defect one level up.
   */
  async function attach(files: readonly File[]) {
    for (const file of files) {
      if (file.size > ATTACH_MAX_BYTES) {
        notifyError(t("fileTooBig", { name: file.name }));
        continue;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        notifyError(t("fileNotText", { name: file.name }));
        continue;
      }
      if (text.includes("\u0000")) {
        // a NUL byte is the honest binary test - an audio file belongs in
        // Echo's uploader, and pretending to read it would feed the model noise
        notifyError(t("fileNotText", { name: file.name }));
        continue;
      }
      const staged = stagedRef.current;
      if (staged.length >= ATTACH_MAX_COUNT) {
        notifyError(t("fileTooMany"));
        return;
      }
      /* one file, one slot: the same file dropped twice is a person repeating
         themselves, not two sources */
      if (staged.some((a) => a.name === file.name)) continue;
      stageFiles([...staged, { name: file.name, text }]);
    }
  }

  /**
   * WHAT THE `@` IS REACHING FOR, asked of the index rather than of a list
   * held in the page.
   *
   * `api.search` is the only NAME search the platform has for records, and its
   * `kind: "call"` hits are exactly the title matches - so a picker built on it
   * shows what the person can SEE, because the search runs under their own
   * identity. A client-side filter over `listCalls()` would have to download
   * the org's whole record list to answer one keystroke.
   *
   * The sequence number is the whole reason this is not a race: two keystrokes
   * are two requests, and the slower one answers last. Without it a fast typist
   * ends up looking at the results for a prefix they have already finished
   * typing (GlobalSearch settled this on the same api, 2026-08-27).
   */
  const mentionSeq = useRef(0);
  useEffect(() => {
    if (mention === null) return;
    const query = mention.trim();
    const seq = ++mentionSeq.current;
    /* the index refuses a shorter query, so a bare `@` shows the FRAME and no
       rows rather than firing a request that can only come back empty */
    if (query.length < MENTION_MIN_QUERY) {
      setMentionHits([]);
      return;
    }
    setMentionHits("searching");
    const timer = setTimeout(() => {
      void api.search(query)
        .then((hits) => {
          if (seq !== mentionSeq.current) return;
          /*
           * TITLE MATCHES ONLY. `kind: "call"` is the index's own word for
           * "this record is CALLED that", and it is the whole answer here: a
           * transcript or summary hit means a record said the word somewhere
           * inside it, which is a fine reason to open a search page and a bad
           * reason to appear in a picker somebody is using to name a meeting.
           *
           * That also settles duplicates without a Set. The index answers one
           * title hit per record, so a de-duplicating pass here would be a
           * guard for a shape this filter has already made impossible - and an
           * unreachable guard is a line the next reader has to disprove.
           */
          setMentionHits(hits.filter((h) => h.kind === "call").slice(0, MENTION_SHOWN));
        })
        .catch(() => { if (seq === mentionSeq.current) setMentionHits([]); });
    }, MENTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mention]);

  /** the box changed: decide whether a mention is being written, and where */
  const onPromptChange = (value: string) => {
    setInput(value);
    const caret = promptRef.current?.selectionStart ?? value.length;
    setMention(mentionQuery(value, caret));
  };

  /**
   * Choosing a call REPLACES the `@query` it was chosen from. The handle is
   * not left in the text: a call is attached as an ID and shown as a chip, so
   * a leftover `@sales` in the sentence would be a second, weaker claim about
   * the same thing - and the one the model would read.
   */
  const attachCall = (hit: SearchHit) => {
    setInput((cur) => cur.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setContextCalls((prev) =>
      prev.some((c) => c.id === hit.call_id) ? prev : [...prev, { id: hit.call_id, title: hit.call_title }],
    );
    setMention(null);
    promptRef.current?.focus();
  };


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

  /**
   * `asOf`: the run a settle-refetch belongs to (the store drops it if a
   * newer run started meanwhile). `wanted`: asked right before adoption, so
   * a resume that was superseded by a second `?c=` while its rows were on
   * the way adopts nothing (2026-09-06: the slower of two fetches used to
   * win, and the skeleton stayed up forever over the wrong thread).
   */
  const adoptThread = useCallback(async (id: string, asOf?: number, wanted?: () => boolean) => {
    const versionAtStart = resetVersionRef.current;
    const [thread, verdicts] = await Promise.all([
      api.agentThread(id),
      api.sessionFeedback(id).catch(() => ({}) as Record<string, string>),
    ]);
    /* A just-cleared hub must not be repopulated by an older in-flight fetch. */
    if (versionAtStart !== resetVersionRef.current) return;
    if (wanted !== undefined && !wanted()) return;
    /* one call: the thread, the id, and the sidebar handoff are one fact, and
       `adoptAssistantThread` publishes them together — a tick apart and the
       skeleton would flash once more over a thread that had already arrived */
    adoptAssistantThread(id, thread.messages, thread.floor, asOf);
    setHeldThreadId(id);
    setFeedback(verdicts);
    setStarted(true);
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
    follow.repin();
    let cancelled = false;
    void adoptThread(continueId, undefined, () => !cancelled).then(() => {
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
    /* a card left open by the conversation just cleared is answered «نه»,
       not left clickable over the next one */
    consentRef.current?.("no");
    consentRef.current = null;
    setConsent(null);
    follow.repin();
    setHeldThreadId(null);
    setInput("");
    setFeedback({});
    stageFiles([]);
    setContextCalls([]);
    setMention(null);
    /* `/assistant`, not `/` — the hub's own address. `/` became the
       dashboard (2026-08-25) and this line kept sending "new conversation"
       to a briefing screen; same seam as the workflow launcher's. */
    if (resumeId) router.replace("/");
  }, [resetVersion, resumeId, router]);

  /**
   * Draft autosave, per conversation (Onyx's composer habit): a half-typed
   * question survives a tab close. sessionStorage, not the server — a draft
   * is a device fact, and the reload-gap rule cuts the other way for text
   * nobody submitted.
   */
  useEffect(() => {
    const key = `neurai-draft-${resumeId ?? "new"}`;
    /* wrapped like every other storage read in web/src: a browser that blocks
       site data throws on the accessor, and an effect that throws unmounts
       the page (2026-09-06 — this pair was the one unwrapped access) */
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) setInput(saved);
    } catch { /* no draft to restore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per conversation
  }, [resumeId]);
  useEffect(() => {
    const key = `neurai-draft-${resumeId ?? "new"}`;
    try {
      if (input) sessionStorage.setItem(key, input);
      else sessionStorage.removeItem(key);
    } catch { /* a draft that cannot be kept is not an error the person can act on */ }
  }, [input, resumeId]);

  const idle = messages.length === 0;
  /* a wanted conversation the screen does not hold yet — see heldThreadId;
     `idle` is still true in this window, which is exactly why it cannot be
     the thing that decides between the welcome screen and a skeleton */
  const loadingThread = resumeId !== null && heldThreadId !== resumeId;

  /* the dashboard LEFT this component (user directive, 2026-08-25): it is
     the landing PAGE now (components/platform/home/Home.tsx), not a view of
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
  useEffect(() => {
    const off = registerAssistantSurface({
    handleClientTool: (event) => handleClientToolCall(event, {
      /* the card below answers this; a surface that cannot ask is refused by
         the runner (it used to fall through — the comment that stood here
         claimed the opposite of what the code did) */
      askConsent: async (label, detail, tool) => {
        const answer = await new Promise<ConsentAnswer>((resolve) => {
          consentRef.current = resolve;
          setConsent({ label, detail, tool, resolve });
        });
        consentRef.current = null;
        setConsent(null);
        return answer;
      },
      push: router.push,
      switchLocale: (next) => router.replace("/", { locale: next }),
    }),
    onSettled: (reason, asOf) => {
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
      void adoptThread(id, asOf).catch(() => undefined);
      if (reason === "done") void refreshDrafts(id);
    },
    });
    return off;
  }, [router, adoptThread, refreshDrafts]);

  /**
   * THE CARD DOES NOT OUTLIVE ITS SURFACE (2026-09-06). Navigating away with
   * a consent card open left its promise pending forever: the store stayed
   * suspended on it, `done` was never read, and every composer refused until
   * a reload. Leaving is a «نه». An UNMOUNT-only effect, deliberately apart
   * from the registration above: that one re-runs whenever its deps change
   * (a router object per render in some harnesses), and a decline riding
   * its cleanup answered cards nobody had left.
   */
  useEffect(() => () => {
    consentRef.current?.("no");
    consentRef.current = null;
  }, []);

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
    follow.repin();
    setStarted(true);
    setInput("");

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
    /* the calls travel as IDS, not as text: the server re-checks who may read
       each one, so a person cannot widen their own reach by naming a record.
       Cleared with the attachments - a scope belongs to the question that was
       asked, not to the box it was typed in. */
    const calls = contextCalls.map((c) => c.id);
    stageFiles([]);
    setContextCalls([]);

    await askAssistant({
      question,
      page: "hub",
      /* the calls the person named with `@`, as CONTEXT. The wire has carried
         them since 0184 and had no producer on this surface after the Sources
         search was removed (2026-09-04); this is that producer. Omitted when
         empty rather than sent as [], so a question with no calls looks on the
         wire exactly like every question asked before today. */
      ...(calls.length > 0 ? { callIds: calls } : {}),
      options: {
          model: model || undefined,
          skill: skill || undefined,
          /* the agent a surface PINNED — a conversation opened from an agent's
             own page. Names in the message are read by the SERVER, which keeps
             the floor (2026-09-06): who was called, until somebody else is. */
          agent: agentHandle ?? undefined,
          workflow: workflowSlug || undefined,
          connectorProvider,
          sourceId: sourceId || undefined,
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
        THE CONVERSATION'S OWN ACTIONS LEFT THIS SCREEN.

        Share and Export stood here as a two-button row above the thread, and
        they were the last thing in it. They are PER-CONVERSATION actions, and
        this screen can only ever ask them about the one conversation already
        open - so the sidebar's kebab, which is beside every conversation and
        already holds this product's other per-row action, answers for all of
        them instead. HomeSidebar owns both now, sharing this component's
        `platform.share` / `platform.exportMd` / `platform.exportYou` words so
        the file and the menu keep saying the same thing.

        Removing the row also removed the last reason for `headerBtn` /
        `headerBtnOn`, the toolbar's own `.btn-sm` spelling: the surviving
        toolbar above this component (AssistantMenu) carries its own.
      */}

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
            NO OPENING LINE.

            «سلام — من دستیار نورای هستم…» stood here as a GREETING rather
            than a message — never persisted, never given a role, never part
            of the thread — and it was still a paragraph of the assistant
            introducing itself on a screen whose whole job is a prompt box.
            The suggestions under it say the same thing in a form you can
            press, and the greeting above them already says hello by name.

            `platform.hubWelcome` left both catalogues with it: dead copy is
            how a fixed thing keeps apologising for itself.
          */}
          {/*
            THE HOME PAGE'S OWN EMPTY STATE.

            A SLOT rather than a branch: this component is the conversation
            and knows nothing about meetings or tasks, and the page that does
            hands it in. It renders here — under the assistant's opening line,
            above the suggestions — because it is the same kind of thing the
            suggestions are: what there is to do before anything has been
            said. The moment a turn exists this whole region is replaced by
            the thread, so nothing here has to be dismissed.

            `/assistant` passes nothing and keeps the bare welcome it has
            always had.
          */}
          {idleContent !== undefined && !workflowSlug ? (
            <div className="mx-auto mt-4 w-full max-w-content">{idleContent}</div>
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
            THE SUGGESTIONS MOVED DOWN TO THE COMPOSER.
            They render as the composer's own first row now - see below.

            They stood HERE from 2026-09-02, under the assistant's opening
            line, on the reasoning that a chip under a greeting reads as
            something to say back rather than as a toolbar bolted to the input.
            That reasoning did not survive its own premise: the greeting was
            removed on 2026-09-08, and this region is `justify-start` inside a
            `flex-1` scroller - so the chips stayed pinned at the TOP under a
            snapshot card, with the empty half of the screen between them and
            the box they fill. A suggestion a screen away from the composer is
            a list of features again, which is exactly what putting them here
            was meant to stop.
          */}
        </div>
      ) : (
        <div
          ref={follow.scrollerRef}
          /* the ONE scrolling region of the active assistant page (md+):
             `min-h-0` lets a flex child actually shrink below its content,
             which is what makes `overflow-y-auto` mean something here. The
             handler keeps the follow decision current — recomputed on every
             scroll, the reader's own or ours, so returning to the bottom
             re-pins without a button. */
          onScroll={follow.onScroll}
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
           *
           * `py-5` IS THE FADE'S WIDTH (2026-09-06): `.fade-scroll` masks the
           * box's first and last 1.25rem to transparent, and with no vertical
           * padding the newest line — the one the reader is looking at — sat
           * inside that band half ghosted whenever the thread was pinned. The
           * padding keeps the words out of the fade; only scrolled-past
           * content passes through it. Tailwind's step 5 is 1.25rem; the
           * follow test reads the edge from the stylesheet and holds the pair.
           */
          className="scroll-quiet fade-scroll -mx-page-inline mb-4 min-h-0 flex-1 overflow-y-auto px-page-inline py-5 md:-mx-page-inline-md md:px-page-inline-md"
        >
          {/* THE ONE WRAPPER the follow observes: everything that can land in
              this box — the thread, the refusal, the consent card, the
              standing yes, a mail draft — renders inside it, so its growth is
              the follow's signal. A child rendered as this wrapper's sibling
              would be invisible to the follow; Hub.follow.test holds that. */}
          <div ref={follow.contentRef}>
            <ConversationThread
              messages={messages}
              streaming={streaming}
              feedback={feedback}
              onFeedback={(id, verdict) => void judge(id, verdict)}
              onRegenerate={() => void regenerate()}
            />
            {consent ? (
              <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3">
                <p className="text-detail text-fg">
                  {tPresence("consentAsk", { action: consent.label })}
                  {consent.detail ? <span className="font-semibold"> — «{consent.detail}»</span> : null}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary btn-sm" onClick={() => consent.resolve("once")}>
                    {tPresence("allow")}
                  </button>
                  {/* the yes for the whole session (2026-09-06) — offered only
                      where it would stand: a delete, a message, an invitation,
                      a role or a scope never gets the button, so the card
                      cannot collect a yes that covers nothing */}
                  {sessionGrantEligible(consent.tool) ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => consent.resolve("session")}>
                      {tPresence("allowSession")}
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => consent.resolve("no")}>
                    {tPresence("decline")}
                  </button>
                </div>
              </div>
            ) : sessionGrant ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-detail text-fg-muted">
                <span>{tPresence("sessionGranted")}</span>
                <button type="button" className="btn btn-sm" onClick={revokeSessionConsent}>
                  {tPresence("sessionRevoke")}
                </button>
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
          </div>
        </div>
      )}

      {/*
        THE SUGGESTIONS SIT ON THE COMPOSER.

        `mx-auto max-w-content` and no gap under them: they take the composer's
        own column and stand on its top edge, so the row and the box read as
        ONE control - which is what a suggestion is, a way of filling the box
        without typing. One press FILLS it; sending stays the person's act,
        the rule these rows have carried since they existed.

        IDLE ONLY, and that is the half worth stating. They used to live inside
        the idle branch, so the `idle` test was structural and invisible; out
        here it has to be written, and without it every answer in a live
        conversation would be followed by four openers for a conversation that
        has already started.

        Every shipped skill's starters rather than a picked one's - the skill
        picker left in the same round that removed the model picker, so "the
        active skill" is always the default and gating on it would show
        nothing.
      */}
      {idle && !loadingThread && !workflowSlug && suggestions.length > 0 ? (
        <div className="mx-auto mb-2 flex w-full max-w-content flex-wrap justify-start gap-2">
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


      {/*
        THE COMPOSER: "instead of the + icon make it attachment,
        delete the create one which doesn't work good - no create feature, and
        only attachment ... add a feature to do @ and add a call ... just
        attach a file, allow drag and drop, support white theme also".

        The shape is the reference's: staged attachments ABOVE the field, the
        field, then a toolbar of left actions and one send. The plus and its
        three submenus are gone - the paperclip opens the file picker on the
        FIRST press, which is the whole reason a dedicated control beats a menu
        here (the same argument the room's own mention button settled).

        The WRAPPER carries the position and the drop target; the panel inside
        it is the field. Two elements because the mention picker hangs off the
        wrapper: `bottom-full` inside the panel would measure from the panel's
        own padding box and open on top of the text.
      */}
      <div
        className={`relative w-full max-w-content ${idle ? "mx-auto mt-auto" : "sticky bottom-0 mx-auto"}`}
        /*
          A FILE DROPPED ON THE BOX IS ATTACHED. Native drag events, and that is
          not R17's business: R17
          governs dragging an element of OURS, where a native `dragstart` fires
          from the nearest draggable ancestor and eats the pointer gesture
          `holdDrag` is built on. A file arriving from the operating system has
          no element of ours and no gesture of ours - the drop event is the
          only way the browser will ever hand it over.

          The COUNTER, not a boolean: `dragenter`/`dragleave` fire for every
          child the pointer crosses, so a flag cleared on leave goes dark the
          moment the cursor passes over the textarea inside the panel, and the
          highlight flickers while the file is still held.
        */
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          /* without this the browser NAVIGATES to the dropped file, which
             throws the half-typed question away to show a text file */
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) void attach(files);
        }}
      >
        {/*
          THE @ PICKER. Upward, because the composer sits at the foot of the
          page - `popover.guard` bans `absolute top-full` for exactly the
          clipping this would hit, and the room's own mention list settled the
          same shape a few days earlier. `glass-chrome` is R23's material for a
          floating panel, so it is the theme's sheet rather than a ground
          chosen here.
        */}
        {mention === null ? null : (
          <div className="absolute bottom-full z-20 mb-1.5 w-72 overflow-hidden rounded-xl glass-chrome shadow-island">
            <ul aria-label={t("mentionCalls")}>
              {mention.trim().length < MENTION_MIN_QUERY ? (
                <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{t("searchHint")}</li>
              ) : mentionHits === "searching" ? (
                <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{t("sourcesSearching")}</li>
              ) : mentionHits.length === 0 ? (
                /* WHICH nothing: the index answered and nothing you can see
                   matched - not "we did not look" and not "there are none" */
                <li className="px-2.5 py-6 text-center text-xs text-fg-subtle">{t("sourcesNoHits")}</li>
              ) : (
                mentionHits.map((hit) => (
                  <li key={hit.call_id}>
                    <button
                      type="button"
                      /* mousedown, not click: the textarea's `blur` closes the
                         picker, and a click fires after blur - so the row was
                         gone before the press landed on it */
                      onMouseDown={(e) => { e.preventDefault(); attachCall(hit); }}
                      className="tap flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-fg hover:bg-surface-2"
                    >
                      <Icon name="video" size="sm" className="shrink-0 text-fg-subtle" />
                      <bdi className="min-w-0 flex-1 truncate font-medium">{hit.call_title}</bdi>
                      <span className="shrink-0 text-caption text-fg-subtle">{formatDate(hit.call_date, locale)}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        <div
          /* focus-within: the PANEL is the control, so the panel carries the
             focus affordance — the global :focus-visible ring on the inner
             input drew a box inside a box (the user's report) */
          /* the composer takes the TABLE width. 660px was a reading measure
             chosen when
             the hub was a centred landing card; on a page whose job is a
             conversation it left the prompt floating in a column half the width
             of every other surface in the product. */
          /* TRANSLUCENT AND EDGED (R23, and the white theme the directive asks
             for arrives with it). Every sheet in the product dropped its
             outline for the glass lip; a FIELD did not, because a card's edge
             is decorative and a control boundary owes 3:1 - and on a
             translucent panel the ground inside an unbordered field is the
             ground behind it. Both sides are tokens, so light is the same two
             declarations rather than a second design. */
          className={`flex w-full flex-col rounded-2xl border bg-surface/70 px-3 pb-0.5 pt-3 text-start backdrop-blur-sm transition-colors ${
            dragging ? "border-accent ring-2 ring-accent/40" : "border-border-strong focus-within:border-accent"
          }`}
        >
          {/* who is in the room, and the × that hands it back to Echo (2026-09-06) */}
          <FloorChip className="mb-1" />

          {/*
            STAGED ABOVE THE FIELD, as the reference does. They were under the
            control row, which put a file the person had just attached BELOW
            the send key - the last place a reader looks before pressing it.
          */}
          {attachments.length > 0 || contextCalls.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span key={a.name} className="chip bg-surface-2 text-xs text-fg">
                  <Icon name="paperclip" size="xs" className="shrink-0 text-fg-subtle" />
                  <span className="ltr max-w-[12rem] truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={t("removeAttachment", { name: a.name })}
                    className="ms-1 text-fg-muted hover:text-fg"
                    onClick={() => stageFiles(stagedRef.current.filter((x) => x.name !== a.name))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {/* a call reads as CONTEXT rather than as a file: the same chip
                  geometry, wearing the accent tint this product uses for "this
                  is scoping the answer" */}
              {contextCalls.map((c) => (
                <span key={c.id} className="chip bg-accent-soft text-xs text-accent">
                  <Icon name="video" size="xs" className="shrink-0" />
                  <bdi className="max-w-[12rem] truncate">{c.title}</bdi>
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

          {/*
            A TEXTAREA, THREE LINES TALL. `resize-none` because the corner grip
            would fight
            the measurement - a dragged height is overwritten by the next
            keystroke, which is a control that works once.
          */}
          <textarea
            ref={promptRef}
            rows={PROMPT_ROWS.min}
            className="scroll-quiet fade-scroll-tight w-full resize-none bg-transparent text-sm leading-6 text-fg outline-none placeholder:text-fg-muted focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder={t("promptPlaceholder")}
            aria-label={t("promptPlaceholder")}
            value={input}
            onChange={(e) => onPromptChange(e.target.value)}
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
              /* Escape closes the PICKER first: it is the thing on top, and a
                 key that stops a run while a menu is open over it did
                 something the person could not see. */
              if (e.key === "Escape") {
                if (mention !== null) {
                  e.preventDefault();
                  setMention(null);
                } else if (streaming) {
                  stop();
                }
              }
            }}
            /* the caret moves without the text changing (arrows, a click), and
               what decides a mention is the run of characters before the caret
               - so the caret's own movements have to be read too */
            onKeyUp={(e) => setMention(mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
            onClick={(e) => setMention(mentionQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
            onBlur={() => setMention(null)}
          />

          {/*
            THE CONTROLS SIT LOW and in FIXED PHYSICAL
            CORNERS (2026-09-03: "put it in right down corner in both fa and en
            version ... the plus and mic together in left down corner").

            `dir="ltr"` on this row is the whole mechanism and a deliberate
            exception to this codebase's logical-properties rule: the person was
            LOOKING AT THE RTL PAGE when they named the corners, so a logical
            form would look right in English and move both clusters to the other
            side of the box they had just pointed at. The TEXT above is
            untouched — prose follows the page.
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
              {/* ONE PRESS, ONE ACT. The plus opened three submenus and every
                  one of them was a decision to make before typing; what the
                  directive asked for is the act itself, wearing its own glyph.
                  `IconUpload` was the near-miss already in the set and it is
                  the wrong word - an arrow into a tray is a file leaving for
                  somewhere, and this one stays in the sentence. */}
              <button
                type="button"
                className="btn btn-icon shrink-0 text-fg-muted hover:bg-surface-2 hover:text-fg"
                aria-label={t("sourcesAttach")}
                title={t("sourcesAttach")}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="paperclip" size="md" />
              </button>
            </span>
            {streaming ? (
              /* send morphs into STOP — one button, one place, per the donor's
                 composer; Esc does the same from the keyboard */
              <button
                type="button"
                className="btn btn-icon shrink-0 bg-surface-2 text-fg"
                title={t("stop")}
                aria-label={t("stop")}
                onClick={stop}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              </button>
            ) : (
              <button
                type="button"
                /* NO FILL. A solid accent square in
                   a composer whose one other accent is the workspace's primary
                   action makes neither of them mean "this is the main thing" —
                   the same call the sidebar's send key took. `disabled:opacity`
                   is what says the box is empty. */
                className="btn btn-icon shrink-0 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                title={t("send")}
                aria-label={t("send")}
                disabled={input.trim() === ""}
                onClick={() => { void send(); }}
              >
                {/* the RETURN key's own glyph, not a paper plane: the button and
                    the Enter shortcut it duplicates stop being two unrelated
                    facts a person has to learn separately */}
                <Icon name="enter" size="sm" />
              </button>
            )}
          </div>

          {dictation.status === "unsupported" || dictation.status === "denied" ? (
            /* two different nothings: "this browser can't" vs "you said no" */
            <p className="mt-2 text-xs leading-5 text-fg-muted">
              {dictation.status === "unsupported" ? t("voiceUnsupported") : t("voiceDenied")}
            </p>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".txt,.md,.csv,.json,.log,.tsv,text/*"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void attach(files);
            }}
          />

          {/* CREATE IS GONE. Its state, its two
              prompt prefixes, its chip and the auto-download effect left with
              it. The `created` tag still travels on the wire and
              ConversationThread still draws the download for any stored answer
              that carries one, so conversations made before today keep their
              file — what left is the PRODUCER, which is what "no create
              feature" names.

              SOURCES went with the same sentence ("no need to have sources
              also just attach a file"), and the web-search toggle went with
              Sources: `options.web` has no producer on this surface now.

              CONNECTORS left with the menu that held them, and are not lost —
              the sidebar composer's own menu still lists them and
              `/integrations` is the page.

              THE MEETING SEARCH's tombstone comes down (2026-09-04: "remove the
              search in source"). It recorded that the `call_ids` wire was
              untouched with no producer here, and that this is where a future
              "ask about this meeting" would arrive. It arrived: the @ picker
              above is that producer. What stays removed is the PANEL — a search
              field inside a dropdown was the thing that was wrong with it, and
              an inline mention needs no field of its own.

              THE RECORDER, THE TOOLS MENU AND THE MODEL/SKILL PICKERS are still
              gone (2026-09-02): a recording belongs to the meeting, the tool
              registry reads as documentation rather than as a composer control,
              and the M5 ladder answers the model question without being asked. */}
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

/*
 * THE COMPOSER'S MENU IS GONE, and with it the three rooms
 * it was the only door to.
 *
 * What stood here was `ComposerActions`: a plus opening Create (Doc/PDF),
 * Sources (attach a file / search the web) and Connectors as Radix submenus,
 * carrying the hover-panel history that preceded them. DELETED rather than
 * hidden - the file picker it wrapped is one press on the paperclip now, and a
 * menu kept for the two entries the directive removed would be a door to two
 * rooms nobody may enter.
 *
 * What each of them was, and where its capability went, is recorded beside the
 * composer instead: the next reader finds the reasons at the site of the
 * absence rather than in a component nothing renders.
 */
