"use client";

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { api } from "@/api/client";
import type { AgentEvent } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { mentionedAgent } from "@/lib/agentMention";
import { executeClientTool, SURFACE_TOOLS } from "@/lib/agentSurface";
import {
  subscribeAssistantOpen,
  subscribeRecordingLive,
} from "@/lib/assistantBus";
import { notify, subscribeNotify, type PlatformNotice } from "@/lib/notify";
import { Icon } from "@/components/icons";
import { speak, speakQueued, stopSpeaking, subscribeSpeechPlayback } from "@/lib/voice";
import { startVoiceLoop, voiceLoopSupported, type VoiceLoopHandle } from "@/lib/voiceLoop";
import { recorderControls } from "@/components/echo/recorderControls";
import { recorderSnapshot } from "@/lib/recordingEngine";
import { SkeletonLines } from "@/components/scaffold/Skeleton";
/* the constants module, not the scaffold barrel: this component is imported by
   the root layout, and the barrel would drag SectionMenu/Resizable into every
   route's graph to fetch one number */
import { SCAFFOLD } from "@/components/scaffold/constants";
import {
  getPresenceAnchorSnapshot,
  getServerPresenceAnchorSnapshot,
  subscribePresenceAnchor,
} from "./presenceAnchor";

/**
 * THE ASSISTANT SIDEBAR (user directive, 2026-09-03: "we are going to remove
 * the orb for now and its placement the line and circle, we are going to add
 * AI assistant side bar the opposite side of the menu in all pages with access
 * to our AI assistant").
 *
 * This is the same assistant it has always been — the thread, the SSE stream,
 * the client-tool broker, the consent cards, the notification toasts, the
 * session handling and the voice loop are unchanged. What was replaced is the
 * CHROME: the orb, the drag-to-pin, the holder rail and its socket, and the
 * floating panel that hung off wherever the orb had been dropped. A panel that
 * follows a draggable ball is a different position on every machine; a column
 * pinned to one edge is the same place for everybody.
 *
 * **The orb is kept, not deleted** — the directive says "for now". The
 * retrieval path, named in full so it can come back as one piece rather than
 * as whichever half somebody remembers:
 *
 *  - `components/platform/EchoEOrb.tsx` — the renderer, still exercised by
 *    `AuroraOrb.test.tsx`, which is what keeps this a working part rather than
 *    a claim about one;
 *  - `lib/useAudioLevel.ts` — `useAudioLevel` (still used by the recorder's
 *    meter) and `useSyntheticPulse` (the orb's breath, now with no caller);
 *  - `lib/voice.ts`'s `currentSpeechAudio()` — the element the level was
 *    measured from, now with no caller either.
 *
 * Those last two are orphans on purpose. A producer with no consumer is
 * normally a defect here; these are the deliberate exception, and writing them
 * down is what keeps them from becoming the accidental kind. Nothing in the
 * product imports any of it, so three.js is in no route's bundle.
 *
 * WHERE IT SITS. Fixed to the inline-END edge, which is the opposite side from
 * the menu rail in BOTH directions — `end-0` resolves through `dir`, so the
 * right edge in English and the left edge in Persian, with no mirroring logic
 * and no chance of landing on the menu's side. It runs from under the top bar
 * to the foot of the window.
 *
 * IT FLOATS, AND IT IS CLOSED UNTIL ASKED FOR. The one time this platform put
 * an assistant pane in the shell it squeezed the content to 40px at 375; the
 * fix made it a `fixed inset-0` overlay that defaulted to OPEN, so every box
 * metric improved while the app became unreachable behind an opaque layer.
 * Both states passed every measurement.
 *
 * So the rule here has two halves, and they were settled one at a time.
 *
 * IT IS A FIXTURE. The assistant sits in the same place on every screen, like
 * the rail on the opposite edge: shut, a narrow strip carrying its own mark;
 * open, the MENU's width (248px, read from SCAFFOLD). For an hour it removed
 * itself from the tree when shut, which the user corrected — "i want it to be
 * in a fixed position in the platform everywhere". A control that is somewhere
 * when you need it and nowhere when you do not is a control you have to look
 * for.
 *
 * IT DOES NOT PUSH. The first version had the shell reserve a gutter and
 * re-flow every screen when the assistant opened; a column that re-lays-out
 * the work you are reading, to make room for a question about it, has the
 * trade backwards. It lies over the page instead.
 *
 * Below `md` the strip is not drawn — 48px across a phone's inline edge buys
 * nothing — and the open state is a full-width overlay, under a top bar that
 * stays visible so a person can still see where they are.
 */

/** who is speaking, when it is not the assistant itself */

interface SidebarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  chips: string[];
  failed?: boolean;
  /** the server's own refusal sentence, when it gave one — a 400's message
      is actionable ("no model selected…"); a bare "did not finish" is not */
  failedDetail?: string;
}

/** the person's own choice, remembered per browser */
const SIDEBAR_KEY = "neurai-assistant-sidebar";

/**
 * THE MENU'S WIDTH, AND IT OVERLAYS (user directive, 2026-09-03: "make it the
 * same size of the menu that we have and in the platform not to push
 * everything and a fixed position with option to make it go close").
 *
 * Three corrections to what shipped this morning, and each was a real
 * complaint:
 *
 *   · 22.5rem (360px) was a width this platform has no other example of. It
 *     matched the menu at 248 for a day; the user then ruled the panel a SHARE
 *     of the screen rather than a twin of the menu (2026-09-03, "give 30% of
 *     the screen to the ai assistant side bar"), which is a different kind of
 *     answer: the menu is as wide as its longest label, and the assistant is
 *     as wide as the room a conversation deserves. Both come from SCAFFOLD, so
 *     neither is a literal that can drift.
 *   · it PUSHED. The shell padded its inline-end by the panel's width, so
 *     opening the assistant re-laid-out every page under it. A column that
 *     re-flows the work you are reading to make room for a question about it
 *     is the wrong trade; it floats over now, and `--assistant-rail` is gone
 *     with the padding.
 *   · the collapsed 48px rail was a second width and a permanent strip. Closed
 *     means CLOSED: nothing is drawn, and the top bar's button is the door.
 */
const PANEL_W =
  `max(${SCAFFOLD.assistantPanelMin / 16}rem, ${SCAFFOLD.assistantPanelPct}vw)`;
/* CLOSED IS A PLACE, NOT AN ABSENCE (user correction, 2026-09-03: "i didnt
   mean closed means nothing is drawn, i want it to be in a fixed position in
   the platform everywhere"). The assistant is a permanent fixture of the
   shell, like the rail on the opposite edge: always there, in the same place,
   on every screen. Shut, it is a narrow strip carrying its own mark; open, it
   is the menu's width. What it never does is push the page — that half of the
   earlier correction stands. */
/* the strip that is always on screen, from the blueprint rather than typed:
   PlatformShell pads by the SAME number so a page centres in what is left,
   and two literals is how the space reserved and the space occupied drift */
const RAIL_W = `${SCAFFOLD.assistantRail / 16}rem`;

/**
 * The top of the column: the top bar's own height, read from the blueprint
 * rather than copied. `${px / 16}rem` is exactly what tailwind.config's `rem()`
 * does for `h-topbar`, so the bar's bottom edge and this top edge are one
 * number — the DockHolder learned that the hard way when the bar grew from 56
 * to 62 and a hand-written 56 left the rail hanging 6px above it.
 */
const SIDEBAR_TOP = `${SCAFFOLD.topBarHeight / 16}rem`;

/**
 * Where the sidebar does NOT appear, and now there is ONE rule instead of a
 * list of directives: **it is silent exactly where the platform shell does not
 * render.**
 *
 * The orb's list had three reasons in it, and the third has been retired by
 * this change. The orb was silent on the assistant's own surfaces
 * (`/assistant`, `/conversations`, `/workflows`, `/agents`, `/integrations`)
 * because "an orb there is a second door to the room you are standing in — one
 * whose panel covers the thing it duplicates". A docked column does not cover
 * what it sits beside, the directive is "in all pages", and the sidebar is now
 * also where AGENTS POST: silencing it on `/agents` would hide an agent's own
 * message on the page about that agent. So those surfaces get it.
 *
 * What stays silent is what renders OUTSIDE the shell entirely:
 *
 *  - **the auth surfaces and the guest join page** — a stranger has no
 *    account, so every element of the shell is a door that refuses, and
 *    offering doors that refuse is worse than offering none;
 *  - **the platform console** — the vendor's operations room, not the product;
 *    it renders outside `PlatformShell`, and an org-scoped assistant has no
 *    authority in it.
 *
 * That is also why the rule is worth stating as one sentence: those pages have
 * no shell to make room in the way, so a fixed column there would lie over
 * their content rather than beside it.
 *
 * A pure function so the rule can be asserted without mounting anything.
 */
export function sidebarIsSilentOn(pathname: string): boolean {
  const route = pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/";
  /*
   * THE PAGE IS ALREADY THE ASSISTANT (user directive, 2026-09-03: "one
   * exception in platform — that in assistant page there is no need for
   * assistant side bar on the page, so remove it there").
   *
   * This is a different reason from every other line here. The rest are
   * silent because the platform SHELL does not render there, so there is no
   * content column to step aside and a fixed strip would lie over the page.
   * /assistant is silent because it is the same conversation at full width: a
   * strip beside it offering to open a second copy is a door into the room
   * you are standing in.
   *
   * And it is the ONE surface where that is true. /agents is a room of
   * agents, not this conversation; /workflows and /integrations are ABOUT the
   * assistant rather than being it — the orb was once silent on all of them
   * and that was too wide.
   */
  if (/^\/assistant(\/|$)/.test(route)) return true;
  if (/^\/platform(\/|$)/.test(route)) return true;
  if (/^\/join(\/|$)/.test(route)) return true;
  return /^\/(sign-in|sign-up|reset|forgot|pending|suspended)(\/|$)/.test(route);
}

export function AssistantSidebar() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const topbarPresenceHost = useSyncExternalStore(
    subscribePresenceAnchor,
    getPresenceAnchorSnapshot,
    getServerPresenceAnchorSnapshot,
  );

  const [member, setMember] = useState(false);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  /** messages that arrived while it was collapsed — the badge on the rail */
  const [input, setInput] = useState("");
  /**
   * THE ROSTER, for `@handle` — read once, rendered nowhere.
   *
   * The agents deliberately have no picker on this surface any more (user
   * directive, 2026-09-03: "i dont want them to come to the AI assistant like
   * a window or options anymore"). They are called by NAME, in the message,
   * which means this component still needs to know which names are names.
   *
   * A failure is silent and leaves the list empty, which degrades to the
   * ordinary assistant answering — the mention is still in the text, so the
   * answer is on-topic; what is lost is which persona wrote it. That is the
   * right forfeit here (M21: degrade what was inferred), and it is why
   * `mentionedAgent` returns null for an empty roster rather than guessing.
   */
  const [handles, setHandles] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void api.agents()
      .then((rows) => { if (alive) setHandles(rows.map((a) => a.handle)); })
      .catch(() => { /* no roster: mentions stay plain text, see above */ });
    return () => { alive = false; };
  }, []);
  const [messages, setMessages] = useState<SidebarMessage[]>([]);
  /** a STORED conversation being fetched — its own state, because "loading"
      and "this conversation is empty" are different sentences and the empty
      copy is a claim about the thread */
  const [loadingThread, setLoadingThread] = useState(false);

  /**
   * COLLAPSED ON FIRST VISIT, then the person's own choice.
   *
   * Not `useState(readStorage())`: the server has no localStorage, so an
   * initial value read from it is a hydration mismatch. Closed is also the
   * safe direction — the failure this platform has already shipped is an
   * assistant pane that defaulted to open.
   */
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === "1") setOpen(true);
    } catch { /* storage unavailable — collapsed, which is the safe default */ }
  }, []);

  function persistOpen(next: boolean): void {
    try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch { /* fine */ }
  }

  /**
   * Show it WITHOUT touching the thread — the door another surface opens when
   * it hands over a conversation or a draft, and the one a running answer
   * opens for itself.
   */
  function reveal(): void {
    setOpen(true);
    persistOpen(true);
  }

  /**
   * The person opening it themselves: a FRESH thread, unless a reply is
   * mid-stream. (A second clause used to protect an agent's message posted
   * while the panel was shut — agents do not post here any more, so the
   * clause went with the badge it existed for rather than being left as a
   * condition that can never be false.)
   */
  function openSidebar(): void {
    if (!streamingRef.current) {
      setMessages([]);
      sessionId.current = undefined;
    }
    reveal();
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  /**
   * CLOSING ENDS THE CONVERSATION (user directive, 2026-08-26: "nothing should
   * remain here as a history"). Collapsing resets the thread silently — the
   * next open is clean, and what was said lives on as a conversation under
   * Assistant → History, deletable there like any other.
   */
  /**
   * Close and end the thread WITHOUT recording a preference — a shutter, not a
   * choice. The voice session timing out is not the person saying "put this
   * away", and writing it to storage would tell them next week that they had
   * collapsed a sidebar a timeout collapsed for them.
   */
  function shutter(): void {
    abortRef.current?.abort();
    setMessages([]);
    sessionId.current = undefined;
    setOpen(false);
  }

  /** the person closing it themselves — the same shutter, remembered */
  function collapseSidebar(): void {
    shutter();
    persistOpen(false);
  }

  /**
   * A fresh thread, not an erasure: the sidebar forgets which conversation it
   * was resuming and starts a new one on the next ask. The old conversation is
   * untouched — it stays under Assistant → History, where archiving lives. A
   * "clear" that deleted the record would be the sidebar deciding what the
   * history says.
   */
  function freshConversation(): void {
    abortRef.current?.abort();
    setMessages([]);
    sessionId.current = undefined;
    notify(t("newConversationStarted"));
  }

  const [streaming, setStreaming] = useState(false);
  const [consent, setConsent] = useState<
    | null
    | { label: string; resolve: (allowed: boolean) => void }
  >(null);
  /** voice state: null = idle; "command" = the post-wake window */
  const [listening, setListening] = useState<"command" | null>(null);
  /** the assistant's own voice is on the speakers */
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  useEffect(() => subscribeSpeechPlayback((next) => {
    speakingRef.current = next;
    setSpeaking(next);
  }), []);
  /**
   * The ONE turn-state line: speaking > thinking > listening.
   *
   * This WORD is the whole of the voice's visible state now. The orb carried
   * it as an animation, and the animation left with the orb — so the header
   * says it instead, which is the same fact in the medium that survives.
   */
  const voiceStatus = speaking
    ? t("speakingState")
    : streaming
      ? t("thinkingState")
      : listening === "command"
        ? t("listening")
        : null;
  /**
   * Silent mode (user directive, 2026-08-21): ON = voice questions get
   * TEXT-only replies (and no spoken "Yes?"); OFF = spoken questions are
   * answered out loud. Listening is untouched either way — the toggle is
   * about the assistant's mouth, not its ears.
   */
  const [silent, setSilent] = useState(false);
  const silentRef = useRef(false);
  /**
   * The EARS toggle (user directive, 2026-08-22): the twin of silent mode for
   * the other direction — off means the assistant stops listening entirely
   * (wake word and capture both down) until switched back on. Persisted;
   * default ON.
   */
  const [ears, setEars] = useState(true);
  const earsRef = useRef(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("neurai-voice-silent") === "1";
      setSilent(stored);
      silentRef.current = stored;
      const earsStored = localStorage.getItem("neurai-voice-ears") !== "0";
      setEars(earsStored);
      earsRef.current = earsStored;
    } catch { /* storage unavailable — voice stays on */ }
  }, []);

  function toggleSilent() {
    const next = !silentRef.current;
    silentRef.current = next;
    setSilent(next);
    try { localStorage.setItem("neurai-voice-silent", next ? "1" : "0"); } catch { /* fine */ }
    notify(next ? t("silentOn") : t("silentOff"));
  }

  function toggleEars() {
    const next = !earsRef.current;
    earsRef.current = next;
    setEars(next);
    try { localStorage.setItem("neurai-voice-ears", next ? "1" : "0"); } catch { /* fine */ }
    if (next) {
      beginLoopRef.current();
      notify(t("earsOn"));
    } else {
      suspendLoop();
      notify(t("earsOff"));
    }
  }
  const [toasts, setToasts] = useState<PlatformNotice[]>([]);
  const sessionId = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** the ONE voice listener (lib/voiceLoop — the 2026-08-22 rebuild) */
  const loopRef = useRef<VoiceLoopHandle | null>(null);
  /** the reply to a VOICE ask is spoken; typed asks stay silent */
  const speakReplyRef = useRef(false);
  const replyTextRef = useRef("");
  const streamingRef = useRef(false);
  /** the running ask, abortable by the spoken/typed STOP intent */
  const abortRef = useRef<AbortController | null>(null);
  /** a barge-in's (or a stale-thread retry's) question, waiting for the
      aborted run to unwind */
  const pendingCommandRef = useRef<{ text: string; viaVoice: boolean } | null>(null);
  /** user rule (2026-08-21): once THIS reply started a recording, the voice
      stays shut — a spoken confirmation would be recorded into the call */
  const muteReplyRef = useRef(false);
  const recordingLive = () => recorderControls.current?.phase() === "recording";

  /**
   * The conversation is OVER — a spoken stop (rule 3), or the loop's session
   * timing out with the sidebar open. One word out loud in the interface
   * language, then CLOSED: speech cut, run aborted, session ended, sidebar
   * collapsed. The name keeps working for next time.
   */
  function farewellClose(): void {
    stopSpeaking();
    loopRef.current?.endSession();
    setListening(null);
    shutter();
    if (!silentRef.current && !recordingLive()) {
      speak(locale === "fa" ? "باشه." : "Okay.");
    }
  }

  /** an utterance the loop decided is a COMMAND — barge-in aware */
  function routeCommand(text: string): void {
    if (speakingRef.current) stopSpeaking(); // barge-in over speaking
    if (streamingRef.current) {
      // barge-in over thinking: abort the run; its unwind asks the new thing
      pendingCommandRef.current = { text, viaVoice: true };
      abortRef.current?.abort();
      return;
    }
    reveal();
    submitRef.current(text, true);
  }

  /** the assistant exists only for signed-in members */
  useEffect(() => {
    let live = true;
    void api.identityState().then((who) => {
      if (live && who.state === "member") setMember(true);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  /** every bus notice becomes a toast, gone after 4s */
  useEffect(() => {
    return subscribeNotify((notice) => {
      setToasts((prev) => [...prev.slice(-2), notice]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== notice.id));
      }, 4000);
    });
  }, []);

  /*
   * AGENTS NO LONGER POST HERE (user directive, 2026-09-03: "i dont want them
   * to come to the AI assistant like a window or options anymore, remove
   * these ... when they [are] called they need to feel alive and chat
   * separate from the ai assistant itself").
   *
   * A subscription lived here that appended an agent's message to this thread
   * with its name and face on it. It went with the unread badge it fed: this
   * panel is the ASSISTANT's conversation, and an agent speaking inside it
   * made the agent a feature of the assistant rather than somebody with a
   * room of their own. `assistantBus`'s post channel went with the last of
   * its callers — a producer with no consumer is a defect its own author
   * cannot see.
   */

  /** Ctrl+E — the agent from anywhere (user directive; was Ctrl+K) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (openRef.current) collapseSidebar();
        else openSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /**
   * Whether the assistant belongs on this screen at all: a member, on a
   * surface where the platform shell renders.
   */
  const visible = member && !sidebarIsSilentOn(pathname);

  /**
   * THE WIDTH THIS COLUMN OCCUPIES, published for the page to step aside by.
   *
   * It went away and came back the same day, and the round trip is the useful
   * part. Version one had PlatformShell pad the whole ROW by it, so the top
   * bar was inset too and opening the assistant re-flowed everything: the user
   * asked for it to stop pushing. Version two removed the reservation
   * entirely — and then the page sat centred in the whole window while a
   * 248px panel covered one side of it, which is the "content is not in the
   * middle" they reported next, with a before/after to settle it.
   *
   * So: published again, read by `main` ALONE (the top bar spans the full
   * width), and carrying the ACTUAL width rather than a constant. Both menus
   * are fixed; the page is the space between them; when this one is wider the
   * page is narrower.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--assistant-rail", visible ? (open ? PANEL_W : RAIL_W) : "0px");
    /* and nothing when the assistant is not on this screen — an auth page has
       no column to leave room for */
    return () => { root.style.setProperty("--assistant-rail", "0px"); };
  }, [visible, open]);

  /**
   * The RECORDING rule (user, 2026-08-21): a rolling take owns the room. The
   * instant it starts the assistant goes deaf (wake recognizer AND relay
   * capture down), quiet (speech cut) and closed. Pause/finish brings the ears
   * back.
   *
   * `setOpen(false)` WITHOUT persisting: this is a shutter, not the person's
   * choice, and writing it to storage would tell them next week that they had
   * collapsed a sidebar a recording collapsed for them.
   */
  useEffect(() => {
    return subscribeRecordingLive((live) => {
      if (live) {
        stopSpeaking();
        suspendLoop();
        setOpen(false);
      } else {
        beginLoopRef.current();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** another surface may hand the sidebar a conversation (the history table) */
  useEffect(() => {
    return subscribeAssistantOpen((request) => {
      reveal();
      if (request.sessionId) void loadSession(request.sessionId);
      if (request.draft) {
        // the composer is uncontrolled here — fill after the pane mounts; a
        // DRAFT only: the person sends it, or doesn't
        const draft = request.draft;
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.value = draft;
            inputRef.current.focus();
          }
        }, 80);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Adopt a STORED conversation as the sidebar's thread — its messages loaded,
   * new questions continuing it.
   */
  async function loadSession(id: string) {
    sessionId.current = id;
    setLoadingThread(true);
    try {
      const thread = await api.agentMessages(id);
      setMessages(thread.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        chips: m.tool_calls.map((c) => c.name).filter((n): n is string => typeof n === "string"),
      })));
    } catch {
      notify(t("failed"), "warn");
    } finally {
      setLoadingThread(false);
    }
  }

  const submitRef = useRef<(question: string, viaVoice: boolean) => void>(() => undefined);
  /** undefined = not fetched yet; null = fetched, nothing usable */
  const modelRef = useRef<string | null | undefined>(undefined);

  /**
   * The sidebar has no model picker, so it climbs M5's ladder itself: the
   * person's SAVED choice first, else the catalogue's first entry (the list
   * arrives suggestion-ranked and already allow-listed by core). Without this
   * every ask from an account that never saved a preference died as an instant
   * 400 — "no model selected" — rendered as a generic "did not finish".
   */
  async function ensureModel(): Promise<string | undefined> {
    if (modelRef.current !== undefined) return modelRef.current ?? undefined;
    try {
      const res = await api.models();
      modelRef.current = res.preferred_model ?? res.models[0]?.id ?? null;
    } catch {
      modelRef.current = null; // core still refuses legibly without one
    }
    return modelRef.current ?? undefined;
  }

  /**
   * Start THE voice loop (the 2026-08-22 rebuild — one listener, the M38
   * relay, bilingual by construction, no browser speech recognition).
   * Denial → a toast asking for access.
   *
   * The wake word is unchanged by this pass. The directive's "voice was not
   * chosen" is about ADDING press-to-talk to the sidebar, which is not built
   * here; what already listens keeps listening.
   */
  const beginLoop = useCallback(() => {
    if (!earsRef.current) return; // the ears toggle is OFF — stay deaf
    if (loopRef.current || recordingLive()) return;
    if (!voiceLoopSupported()) {
      notify(t("voiceUnsupported"), "warn");
      return;
    }
    void startVoiceLoop({
      onWake: () => {
        if (streamingRef.current) return; // one conversation turn at a time
        reveal();
        if (!silentRef.current && !recordingLive()) speak(t("wakeAck"));
      },
      onCommand: (command) => routeCommand(command),
      onStop: () => farewellClose(),
      onState: (state) => setListening(state === "session" ? "command" : null),
    }).then((handle) => {
      if (!handle) {
        notify(t("micDenied"), "warn");
        return;
      }
      if (loopRef.current) { handle.stop(); return; } // a race — keep one
      loopRef.current = handle;
      handle.setSpeaking(speakingRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const beginLoopRef = useRef(beginLoop);
  beginLoopRef.current = beginLoop;

  function suspendLoop() {
    loopRef.current?.stop();
    loopRef.current = null;
    setListening(null);
  }

  /**
   * HALF-DUPLEX (2026-08-26): while the assistant's voice plays, the mic is
   * fully muted — and it stays muted for a beat after playback ends, because
   * the transcriber's tail arrives AFTER the audio stops and that tail is our
   * own last words.
   */
  const unmuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => subscribeSpeechPlayback((next) => {
    const handle = loopRef.current;
    if (!handle) return;
    if (next) {
      if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
      unmuteTimer.current = null;
      handle.setSpeaking(true);
      handle.setMuted(true);
    } else {
      unmuteTimer.current = setTimeout(() => {
        loopRef.current?.setSpeaking(false);
        loopRef.current?.setMuted(false);
      }, 800);
    }
  }), []);

  /** the ears open on landing (member only); leaving closes them */
  useEffect(() => {
    if (!member) return;
    beginLoopRef.current();
    return () => suspendLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  const askConsent = useCallback((label: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConsent({ label, resolve });
    });
  }, []);

  async function submit(question: string, viaVoice: boolean) {
    const trimmed = question.trim();
    if (!trimmed || streamingRef.current) return;
    reveal();
    setStreaming(true);
    streamingRef.current = true;
    speakReplyRef.current = viaVoice;
    muteReplyRef.current = false;
    replyTextRef.current = "";
    const replyId = `p-${Date.now()}`;
    const userMsgId = `u-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed, chips: [] },
      { id: replyId, role: "assistant", content: "", chips: [] },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const model = await ensureModel();
      /* `@roya` routes the turn to Roya. The mention stays IN the question —
         "what do you think, @ava?" reads differently to its answerer than
         "what do you think?", and the one being addressed is exactly who
         should see that they were. */
      const mention = mentionedAgent(trimmed, handles);
      /**
       * PRESENT IN THE MEETING (user directive, 2026-09-03: "in the meetings
       * they also are present in the background and even if they asked
       * question mid conversation about something in the ai assistant panel
       * they must answer").
       *
       * A meeting in progress has no record to search — no call row, no
       * transcript, nothing the read tools can reach — so an assistant asked
       * "what did she just say about the deadline" had, quite literally,
       * nothing to answer from and said so politely. The live captions are
       * the only place that sentence exists yet.
       *
       * Read from the engine's snapshot at SEND time rather than subscribed
       * to: this component does not render a word of it, and subscribing
       * would re-render the whole panel on every caption token for the sake
       * of a string used once.
       *
       * Only while the light is on. `finals` survives in the snapshot after a
       * take ends, and sending it afterwards would attach a stale meeting to
       * an unrelated question — the record is the source once there is one.
       */
      const engine = recorderSnapshot();
      const live = engine.phase === "recording" || engine.phase === "paused"
        ? (engine.captions?.finals ?? "").trim()
        : "";
      const stream = api.ask(trimmed, { page: pathname, callIds: [] }, sessionId.current, {
        model,
        locale,
        ...(mention === null ? {} : { agent: mention.handle }),
        ...(live === "" ? {} : { liveText: live }),
        clientTools: [...SURFACE_TOOLS],
        surface: { route: pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/" },
        signal: controller.signal,
      });
      /*
       * SENTENCE-STREAMED SPEECH (latency rework): a voice reply starts
       * SPEAKING at the first finished sentence, while the rest still streams
       * — not after the whole answer landed and synthesized.
       */
      let spokenIdx = 0;
      const speakNewSentences = (finalFlush: boolean) => {
        if (!speakReplyRef.current || silentRef.current) return;
        // a live recording means NO voice — ours would be in the call audio
        if (muteReplyRef.current || recordingLive()) return;
        const text = replyTextRef.current;
        if (finalFlush) {
          const tail = text.slice(spokenIdx).trim();
          spokenIdx = text.length;
          if (tail) speakQueued(tail);
          return;
        }
        let lastEnd = -1;
        const boundary = /[.!?؟…]\s|\n/g;
        boundary.lastIndex = spokenIdx;
        for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
          lastEnd = m.index + m[0].length;
        }
        // tiny fragments wait for company — per-sentence synthesis is a
        // request each, and "Yes." alone is not worth one
        if (lastEnd > spokenIdx && lastEnd - spokenIdx >= 25) {
          const chunk = text.slice(spokenIdx, lastEnd).trim();
          spokenIdx = lastEnd;
          if (chunk) speakQueued(chunk);
        }
      };
      for await (const event of stream) {
        await handleEvent(event, replyId);
        if (event.type === "text_delta") speakNewSentences(false);
      }
      speakNewSentences(true);
    } catch (cause) {
      if (controller.signal.aborted) {
        // the person said STOP — keep whatever was already said, drop an
        // empty bubble; an interruption is not a failure
        setMessages((prev) => prev.filter((m) => !(m.id === replyId && m.content === "")));
      } else {
        const detail = (cause as { detail?: string }).detail;
        const status = (cause as { status?: number }).status;
        /*
         * THE STALE-THREAD TRAP (user screenshot, 2026-08-22: EVERY ask died
         * "not found"): the stored conversation id can be gone — swept, purged,
         * or minted against a different database. A dead thread must not kill
         * every future question: drop the id, remove the doomed bubbles, retry
         * ONCE fresh. A second failure has no stored id and reports honestly.
         */
        if (sessionId.current && (status === 404 || /not.?found/i.test(detail ?? ""))) {
          sessionId.current = undefined;
          setMessages((prev) => prev.filter((m) => m.id !== replyId && m.id !== userMsgId));
          pendingCommandRef.current = { text: trimmed, viaVoice };
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, failed: true, failedDetail: detail } : m)));
        }
      }
    } finally {
      setStreaming(false);
      streamingRef.current = false;
      setConsent(null);
      // a barge-in (or the stale-thread retry) parked its question while this
      // run unwound — ask it now
      const queued = pendingCommandRef.current;
      if (queued) {
        pendingCommandRef.current = null;
        setTimeout(() => submitRef.current(queued.text, queued.viaVoice), 0);
      }
    }
  }
  submitRef.current = (question, viaVoice) => { void submit(question, viaVoice); };

  function send() {
    const question = input.trim();
    if (!question) return;
    setInput("");
    void submit(question, false);
  }

  async function handleEvent(event: AgentEvent, replyId: string) {
    switch (event.type) {
      case "session":
        sessionId.current = event.id;
        break;
      case "text_delta":
        replyTextRef.current += event.delta;
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: m.content + event.delta } : m)));
        break;
      case "tool_call":
        if (event.state === "started") {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, chips: [...m.chips, event.label] } : m)));
        }
        break;
      case "client_tool_call": {
        // consent BEFORE execution for write-effect calls; the loop blocks here
        // deliberately — the server is waiting on this very answer
        const allowed = event.requires_consent ? await askConsent(event.label) : true;
        setConsent(null);
        if (!allowed) {
          await api.deliverToolResult(event.id, false, "the user declined").catch(() => undefined);
          break;
        }
        const result = await executeClientTool(event.tool, event.args, {
          push: router.push,
          // the top bar's own switch mechanism: same route, other locale
          switchLocale: (next) => router.replace(
            pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/",
            { locale: next },
          ),
        });
        // NO toast for the assistant's own actions (user directive,
        // 2026-08-22): the conversation already shows the tool chip and the
        // model narrates the outcome — a popup on top was the same fact a
        // third time. Toasts remain for everything ELSE on the platform.
        // starting/resuming a recording SHUTS the voice for this reply — and
        // cuts anything already being said (user rule, 2026-08-21)
        if (result.ok && (event.tool === "start_recording" || event.tool === "resume_recording")) {
          muteReplyRef.current = true;
          stopSpeaking();
        }
        await api.deliverToolResult(event.id, result.ok, result.detail).catch(() => undefined);
        break;
      }
      case "done":
        if (event.failed) {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, failed: true } : m))
              .filter((m) => !(m.id === replyId && event.failed && m.content === "")));
        }
        break;
      default:
        break; // unknown-ignorable, the wire's contract
    }
  }

  if (!visible) return null;

  /**
   * THE ONE DOOR, IN ONE PLACE AT A TIME.
   *
   * ONE button, in ONE place: the top bar, at every width. It was written
   * once and placed twice while a collapsed rail existed to carry it from md
   * up; the rail went on 2026-09-03 and the second placement went with it.
   *
   * It stays a toggle while open (`aria-expanded`) — pressing it again
   * collapses, which is also what the header's ✕ does.
   */
  const trigger = (extra: string) => (
    <button
      type="button"
      /* a stable handle for the ONE door: its accessible name is prose and
         shares words with the panel's own controls, so a test matching on the
         name finds two the moment the panel is open */
      data-assistant-door
      className={`btn btn-icon relative text-fg-muted hover:bg-surface-2 hover:text-fg ${extra}`}
      aria-label={t("openLabel")}
      aria-expanded={open}
      title={`${t("openLabel")} (Ctrl+E)`}
      onClick={() => (open ? collapseSidebar() : openSidebar())}
    >
      <Icon name="sparkle" size="md" />
    </button>
  );

  const headerButton = "btn btn-icon text-fg-muted hover:bg-surface-2 hover:text-fg";
  /* the same class, and deliberately so: the bottom row is the header's
     controls MOVED, not a new family of them */
  const composerButton = headerButton;

  /**
   * Drop an `@` into the box and put the cursor after it, so the next thing
   * typed is a handle. It writes the token rather than opening a picker: the
   * user asked to be able to "write in the chat @roya or @ava", and a menu
   * that inserts what you could have typed is a second way to do one thing.
   */
  function mentionAgent(): void {
    setInput((prev) => (prev === "" || prev.endsWith(" ") ? `${prev}@` : `${prev} @`));
    inputRef.current?.focus();
  }

  return (
    <>
      {/* ALWAYS ON SCREEN (user correction, 2026-09-03). For an hour this was
          `{open ? … : null}` — closed meant the element left the tree — and
          that was a misreading: the assistant is a fixed part of the platform,
          in the same place on every page, and what "close" does is narrow it
          to its strip rather than remove it. */}
      <aside
        aria-label={t("title")}
        data-assistant-sidebar
        data-open={open ? "true" : "false"}
        /* `end-0` is the INLINE end — the right edge in English, the left edge
           in Persian, which is the opposite side from the rail in both. Written
           logically on purpose: `right-0` would put the assistant on top of the
           menu for every Persian reader and look correct in English. */
        style={{ top: SIDEBAR_TOP, "--assistant-w": open ? PANEL_W : RAIL_W } as CSSProperties}
        /* Below md a SHUT assistant would put a 48px strip across a phone's
           inline edge for no gain, so the strip is a desktop fixture and the
           open state is a full-width overlay there. `shadow-xl` because it
           lies OVER the page rather than in a column of its own — an overlay
           with no edge reads as part of what it covers. */
        className={`fixed bottom-0 end-0 z-30 flex-col border-s border-border bg-surface shadow-xl md:flex md:w-[var(--assistant-w)] ${
          open ? "flex w-full" : "hidden"
        }`}
      >
        {open ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
              <span className="text-pane-title font-semibold text-fg">{t("title")}</span>
              {voiceStatus ? (
                <span className="text-group-label text-accent">{voiceStatus}</span>
              ) : null}
              {/* THE VOICE CONTROLS MOVED DOWN (user directive, 2026-09-03:
                  "put the icons of the ai assistant in bottom row + mic and
                  speaker, without a fill and look like the other"). They sat
                  here in filled accent-soft wells, so two of the four header
                  icons read as lit warnings rather than as a state — and they
                  belong beside the thing they act on, which is the composer.
                  The header keeps what NAMES the room and what closes it. */}
              <button
                type="button"
                className={`${headerButton} ms-auto`}
                aria-label={t("newConversation")}
                title={t("newConversation")}
                onClick={freshConversation}
              >
                <Icon name="plus" size="md" />
              </button>
              <button
                type="button"
                className={headerButton}
                aria-label={t("close")}
                title={t("close")}
                onClick={collapseSidebar}
              >
                <Icon name="close" size="md" />
              </button>
            </div>

            <div className="scroll-quiet min-h-24 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {loadingThread ? (
                /* the frame is structure and structure is known: a stored
                   conversation being fetched draws lines where its lines will
                   be, so "still loading" never wears the empty state's copy */
                <SkeletonLines lines={4} />
              ) : messages.length === 0 ? (
                <p className="text-detail leading-6 text-fg-muted">{t("empty")}</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] rounded-2xl rounded-ee-sm bg-accent-soft px-3 py-2 text-detail leading-6 text-fg"
                          : "text-detail leading-6 text-fg"
                      }
                    >
                      {m.content}
                      {m.chips.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {m.chips.map((chip, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-surface-2 px-2 py-0.5 text-group-label text-fg-muted"
                            >
                              {chip}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {m.failed ? (
                        <span className="mt-1 block text-group-label text-warning">
                          {t("failed")}
                          {m.failedDetail ? (
                            <span className="block" dir="ltr">{m.failedDetail}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {consent ? (
                <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
                  <p className="text-detail text-fg">{t("consentAsk", { action: consent.label })}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => consent.resolve(true)}
                    >
                      {t("allow")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => consent.resolve(false)}
                    >
                      {t("decline")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            <form
              className="border-t border-border p-2"
              onSubmit={(e) => { e.preventDefault(); send(); }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                className="input w-full resize-none py-2.5"
                placeholder={t("placeholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
              />
              {/*
                THE BOTTOM ROW (user directive, 2026-09-03). Mic, speaker and
                the mention control sit under the box they act on, in the
                theme's plain icon button — NO FILL. The two voice toggles wore
                `bg-accent-soft` wells when engaged, which on a dark panel
                reads as two lit warnings; the OFF state is carried by
                `<Icon off>`, the theme's own slashed glyph, and ON is simply
                the icon.
              */}
              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  className={composerButton}
                  aria-label={t("earsLabel")}
                  aria-pressed={!ears}
                  title={t("earsLabel")}
                  onClick={toggleEars}
                >
                  <Icon name="mic" size="md" off={!ears} />
                </button>
                <button
                  type="button"
                  className={composerButton}
                  aria-label={t("silentLabel")}
                  aria-pressed={silent}
                  title={t("silentLabel")}
                  onClick={toggleSilent}
                >
                  <Icon name="speaker" size="md" off={silent} />
                </button>
                {/*
                  CALLING AN AGENT IN (user directive: "add @ as well for
                  mentioning the agents into the chat so they can be called —
                  the user can write in the chat @roya or @ava as well").
                  The button WRITES the token; typing it by hand does the same
                  thing, which is the point — it is a reminder the mechanism
                  exists, not a second mechanism. The handles are the ones
                  db/0163 seeds, and they are the same tokens an agent uses to
                  hand work to another agent in a room, so one convention
                  covers both directions.
                */}
                <button
                  type="button"
                  className={composerButton}
                  aria-label={t("mentionLabel")}
                  title={t("mentionLabel")}
                  onClick={mentionAgent}
                >
                  <Icon name="at" size="md" />
                </button>
                <button
                  type="submit"
                  className="btn-primary btn-sm ms-auto"
                  disabled={streaming || input.trim() === ""}
                >
                  {streaming ? "…" : t("send")}
                </button>
              </div>
            </form>
          </>
        ) : (
          /* SHUT: the mark alone, and it is the door. A strip with a second
             control would be a menu, and the room it opens already has one. */
          <div className="flex flex-col items-center gap-2 py-3">{trigger("")}</div>
        )}
      </aside>

      {/*
        THE TOASTS. Positioned inside a transparent, pointer-transparent frame
        that used to carry the shell's own `--assistant-rail` padding so a
        notice landed beside the sidebar. There is no gutter to step around any
        more (the panel floats over), so the frame is plain — and the toasts
        sit at the same inline-end, which is where the panel is when it is
        open. That overlap is accepted rather than unnoticed: a notice is a
        few seconds and the panel is a place, and moving the stack to the
        opposite edge would put it under the menu instead.

        z-40, NOT z-50 (user report, 2026-09-02: "the orb is coming on top of
        the pop up window on the side"). The modal layer is z-50 —
        `components/ui/dialog.tsx` — and a tie between two portals is decided by
        DOM order, which is a coin toss. The assistant is chrome and a dialog is
        the thing you are answering, so the ladder is stated rather than raced:
        everything here sits at 40 or below. `stacking.guard.test.ts` keeps it.
      */}
      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed inset-0 z-40">
          <div className="absolute end-4 top-16 flex w-[min(88vw,20rem)] flex-col items-end gap-1.5 md:end-6">
            {toasts.map((notice) => (
              <p
                key={notice.id}
                role="status"
                className={`toast-from-bell rounded-xl border px-3 py-1.5 text-group-label shadow-lg ${
                  notice.kind === "warn"
                    ? "border-warning/40 bg-surface text-warning"
                    : "border-border bg-surface text-fg"
                }`}
              >
                {notice.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {/* the other half of the one door — see `trigger` */}
      {/*
        THE ONE DOOR, AT EVERY WIDTH (2026-09-03).
        
        It was `md:hidden`, because the collapsed 48px rail carried the button
        from md up. The rail went — closed means nothing is drawn — so without
        dropping that class the assistant had no way to open on a desktop at
        all: a door that exists only on a phone.
        
        And it FALLS BACK. The button is portalled into the top bar, which is a
        different component's element; when that host is absent the portal
        renders nothing, and with the rail gone there would be no way in at
        all. A door whose existence depends on another component being mounted
        is a door that can vanish, so the fallback is a plain fixed button at
        the same inline-end. Never both: the portal wins when it exists.
      */}
      {topbarPresenceHost
        ? createPortal(trigger(""), topbarPresenceHost)
        : trigger("fixed bottom-4 end-4 z-30 border border-border bg-surface shadow-lg")}
    </>
  );
}
