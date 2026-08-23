"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { api } from "@/api/client";
import type { AgentCardItem, AgentEvent } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { executeClientTool, SURFACE_TOOLS } from "@/lib/agentSurface";
import { subscribeAssistantOpen, subscribeRecordingLive } from "@/lib/assistantBus";
import { notify, subscribeNotify, type PlatformNotice } from "@/lib/notify";
import { useAudioLevel, useSyntheticPulse } from "@/lib/useAudioLevel";
import {
  currentSpeechAudio, speak, speakQueued, stopSpeaking, subscribeSpeechPlayback,
} from "@/lib/voice";
import { startVoiceLoop, voiceLoopSupported, type VoiceLoopHandle } from "@/lib/voiceLoop";
import { AuroraOrb, type AuroraState } from "./AuroraOrb";
import { recorderControls } from "@/components/echo/recorderControls";
import {
  getPresenceAnchorSnapshot,
  getServerPresenceAnchorSnapshot,
  subscribePresenceAnchor,
} from "./presenceAnchor";

/**
 * PRESENCE (M34) — the agent, always there.
 *
 * One persistent dock on every route: the collapsed orb sits in the platform
 * top bar's glass cradle, then falls back to the corner on routes without that
 * shell. The dock itself never remounts, so moving its ONE button does not
 * reset the panel, voice wake word, unread state or conversation.
 *
 * VOICE (user directive, 2026-08-21): the dock listens for its name —
 * «echo», «hi echo», «salam echo», «سلام اکو». A command in the same
 * breath ("hey echo, record new call") is sent immediately, no button;
 * the name alone gets a spoken "Yes?" and an 8-second window for the
 * command. A voice-initiated ask is answered OUT LOUD in the language it
 * was asked in. All of it is feature-detected and mic-permission-gated:
 * denial produces a toast at the orb's head asking for access, never a
 * silent nothing.
 *
 * NOTIFICATIONS: every notice on the bus pops as a small toast above the
 * orb (auto-dismissed); the top-bar bell keeps the history.
 *
 * Client tools (M33): the dock is the surface's EXECUTOR. A ui-effect call
 * runs immediately through the same code paths a human uses; a write-effect
 * call renders a consent card first — Allow performs it, Decline reports
 * "declined", and either way the run continues with the truth. The consume
 * loop AWAITS the person's choice: no further events arrive while the
 * server waits on the result, so blocking here is the honest shape.
 */

const PRESENCE_KEY = "neurai-presence-session";

interface DockMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  chips: string[];
  failed?: boolean;
  /** the server's own refusal sentence, when it gave one — a 400's message
      is actionable ("no model selected…"); a bare "did not finish" is not */
  failedDetail?: string;
}

function todayKey(): string {
  return `${PRESENCE_KEY}:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * The mic glyph (user-supplied shape, 2026-08-22): a filled capsule, the
 * open cradle arc, a stem. Drawn as an SVG in currentColor rather than the
 * provided PNG so it follows the theme — a black bitmap would vanish on
 * the dark surface. `slashed` is the off state.
 */
function MicIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <line
        x1="12" y1="18" x2="12" y2="21.5"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
      />
      {slashed ? (
        /* the off state matches the speaker toggle's grammar: the same
           glyph with a red slash — no badge, no filled circle (user
           directive 2026-08-22: "a simple red slash on it is enough") */
        <line
          x1="4" y1="3" x2="20" y2="21"
          className="text-danger"
          stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

export function PresenceDock() {
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
  /** minimized = the conversation stays alive behind a compact pill —
      distinct from close, which puts everything back into the orb */
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DockMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [consent, setConsent] = useState<
    | null
    | { label: string; resolve: (allowed: boolean) => void }
  >(null);
  /** M35: the proactivity channel — refreshed whenever the panel opens.
      The dial and the digest toggle moved to Settings·Assistant (user
      directive, 2026-08-21) — the dock carries conversation, not config. */
  const [cards, setCards] = useState<AgentCardItem[]>([]);
  /** voice state: null = idle; "command" = the post-wake / mic-button window */
  const [listening, setListening] = useState<"command" | null>(null);
  /** the assistant's own voice is on the speakers (drives the orb's state) */
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  useEffect(() => subscribeSpeechPlayback((next) => {
    speakingRef.current = next;
    setSpeaking(next);
  }), []);
  /* the orb's breath: the REAL level when the M37 server voice plays (an
     analysable element), a graceful synthetic pulse for speechSynthesis
     and for the listening session (neither has a tappable stream) */
  const measuredLevel = useAudioLevel(speaking ? currentSpeechAudio() : null);
  const syntheticLevel = useSyntheticPulse(
    (speaking && currentSpeechAudio() === null) || listening === "command",
  );
  const orbLevel = measuredLevel > 0 ? measuredLevel : syntheticLevel;
  /** the ONE turn-state line: speaking > thinking > listening */
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
   * The EARS toggle (user directive, 2026-08-22): the twin of silent mode
   * for the other direction — off means the assistant stops listening
   * entirely (wake word and capture both down) until switched back on.
   * Persisted; default ON.
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
  /** user rule (2026-08-21): once THIS reply started a recording, the
      voice stays shut — a spoken confirmation would be recorded into the
      call and "cause confusion" */
  const muteReplyRef = useRef(false);
  const recordingLive = () => recorderControls.current?.phase() === "recording";

  /**
   * The conversation is OVER — a spoken stop (rule 3), or the loop's
   * session timing out with the panel open. One word out loud in the
   * interface language, then CLOSED: speech cut, run aborted, session
   * ended, panel gone. The name keeps working for next time.
   */
  function farewellClose(): void {
    stopSpeaking();
    abortRef.current?.abort();
    loopRef.current?.endSession();
    setListening(null);
    setOpen(false);
    setMinimized(false);
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
    setOpen(true);
    setMinimized(false);
    submitRef.current(text, true);
  }

  /** the dock exists only for signed-in members */
  useEffect(() => {
    let live = true;
    void api.identityState().then((who) => {
      if (live && who.state === "member") setMember(true);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  /** today's thread, resumed — yesterday's key is simply never read again */
  useEffect(() => {
    try {
      sessionId.current = localStorage.getItem(todayKey()) ?? undefined;
    } catch { /* storage unavailable — a fresh thread each page is the floor */ }
  }, []);

  /** every bus notice becomes a toast at the orb's head, gone after 4s */
  useEffect(() => {
    return subscribeNotify((notice) => {
      setToasts((prev) => [...prev.slice(-2), notice]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== notice.id));
      }, 4000);
    });
  }, []);

  /** Ctrl+E — the agent from anywhere (user directive; was Ctrl+K) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setMinimized(false);
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /** cards ride the panel's open (and once for the orb dot) */
  useEffect(() => {
    if (!member) return;
    void api.cards().then((res) => setCards(res.cards)).catch(() => undefined);
  }, [member, open]);

  /**
   * The RECORDING rule (user, 2026-08-21): a rolling take owns the room.
   * The instant it starts — agent-started or button-started — the
   * assistant goes deaf (wake recognizer AND relay capture down), quiet
   * (speech cut), and closed (orb only). Pause/finish brings the ears
   * back. Without this, the meeting arrived twice: once in the call,
   * once as assistant commands.
   */
  useEffect(() => {
    return subscribeRecordingLive((live) => {
      if (live) {
        // rule 2: a rolling take owns the room — deaf, silent, closed
        stopSpeaking();
        suspendLoop();
        setOpen(false);
        setMinimized(false);
      } else {
        beginLoopRef.current();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** another surface may hand the dock a conversation (the history table) */
  useEffect(() => {
    return subscribeAssistantOpen((request) => {
      setOpen(true);
      setMinimized(false);
      if (request.sessionId) void loadSession(request.sessionId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Adopt a STORED conversation as the dock's thread — its messages loaded,
   * new questions continuing it. This replaced routing to /conversations:
   * with the docked pane gone everywhere, the dock is the reader.
   */
  async function loadSession(id: string) {
    sessionId.current = id;
    try { localStorage.setItem(todayKey(), id); } catch { /* fine */ }
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
    }
  }

  const submitRef = useRef<(question: string, viaVoice: boolean) => void>(() => undefined);
  /** undefined = not fetched yet; null = fetched, nothing usable */
  const modelRef = useRef<string | null | undefined>(undefined);

  /**
   * The dock has no model picker, so it climbs M5's ladder itself: the
   * person's SAVED choice first, else the catalogue's first entry (the
   * list arrives suggestion-ranked and already allow-listed by core).
   * Without this every dock ask from an account that never saved a
   * preference died as an instant 400 — "no model selected" — rendered
   * as a generic "did not finish" (found live, user report 2026-08-21).
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
   * Denial → a toast at the orb's head asking for access.
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
        setOpen(true);
        setMinimized(false);
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

  /** the loop's stop-while-speaking rule needs to know the mouth's state */
  useEffect(() => subscribeSpeechPlayback((next) => {
    loopRef.current?.setSpeaking(next);
  }), []);

  /** the ears open on landing (member only); leaving closes them */
  useEffect(() => {
    if (!member) return;
    beginLoopRef.current();
    return () => suspendLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  function openCard(card: AgentCardItem) {
    if (!card.read) {
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, read: true } : c)));
      void api.markCardRead(card.id).catch(() => undefined);
    }
    // the card's content LIVES in its conversation — load it right here,
    // where the person already is, instead of routing them away
    if (card.session_id) void loadSession(card.session_id);
  }

  const unread = cards.filter((c) => !c.read).length;

  const askConsent = useCallback((label: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConsent({ label, resolve });
    });
  }, []);

  async function submit(question: string, viaVoice: boolean) {
    const trimmed = question.trim();
    if (!trimmed || streamingRef.current) return;
    setOpen(true);
    setMinimized(false);
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
      const stream = api.ask(trimmed, { page: pathname, callIds: [] }, sessionId.current, {
        model,
        locale,
        clientTools: [...SURFACE_TOOLS],
        surface: { route: pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/" },
        signal: controller.signal,
      });
      /*
       * SENTENCE-STREAMED SPEECH (latency rework): a voice reply starts
       * SPEAKING at the first finished sentence, while the rest still
       * streams — not after the whole answer landed and synthesized.
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
         * THE STALE-THREAD TRAP (user screenshot, 2026-08-22: EVERY ask
         * died "not found"): the dock resumes today's stored conversation
         * id, but that row can be gone — swept, purged, or minted against
         * a different database. A dead thread must not kill every future
         * question: drop the id, remove the doomed bubbles, retry ONCE
         * fresh. A second failure has no stored id and reports honestly.
         */
        if (sessionId.current && (status === 404 || /not.?found/i.test(detail ?? ""))) {
          sessionId.current = undefined;
          try { localStorage.removeItem(todayKey()); } catch { /* fine */ }
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
      // a barge-in (or the stale-thread retry) parked its question while
      // this run unwound — ask it now
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
        try { localStorage.setItem(todayKey(), event.id); } catch { /* fine */ }
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
        // consent BEFORE execution for write-effect calls; the loop blocks
        // here deliberately — the server is waiting on this very answer
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
        // 2026-08-22, reversing the 08-21 announcement): the conversation
        // already shows the tool chip and the model narrates the outcome —
        // a popup on top was the same fact a third time. Toasts remain for
        // everything ELSE on the platform (saves, failures, table actions).
        // starting/resuming a recording SHUTS the voice for this reply —
        // and cuts anything already being said (user rule, 2026-08-21)
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

  if (!member) return null;
  /* the PLATFORM CONTROL is the vendor's operations room, not the product
     (user directive, 2026-08-23: "remove the orb from the platform
     control") — no assistant presence there. The loop keeps running so
     the ears survive a visit; only the rendering stands down. */
  if (/^\/(fa|en)\/platform(\/|$)/.test(pathname)) return null;

  const anchoredToTopbar = topbarPresenceHost !== null;
  /* the small ring pokes ~21/24px below the 56px bar — surfaces hang just
     under that (user redesign, 2026-08-22) */
  const surfacePosition = anchoredToTopbar
    ? "left-1/2 top-[88px] -translate-x-1/2 md:top-[92px]"
    : "bottom-[142px] end-4 md:bottom-[192px] md:end-6";
  const panelHeight = anchoredToTopbar
    ? "max-h-[calc(100dvh-7rem)]"
    : "max-h-[70dvh]";

  const assistantButton = (
    <button
      type="button"
      aria-label={t("openLabel")}
      title={`${t("openLabel")} (Ctrl+E)`}
      className={
        anchoredToTopbar
          ? "tap relative z-10 block h-full w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          : "tap fixed bottom-4 end-4 z-40 block h-[76px] w-[76px] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:bottom-6 md:end-6 md:h-[104px] md:w-[104px]"
      }
      onClick={() => {
        setMinimized(false);
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      }}
    >
      {/* The particle field is decorative; this button remains the single
          accessible and interactive assistant control in either location.
          Silent mode deliberately does NOT reach the orb (user ruling,
          2026-08-22: "the particles must move all the time — it does not
          depend on anything"): silent is about the VOICE, and the frozen
          orb read as a dead assistant. The orb's "muted" state stays in
          its contract, unused by this consumer. */}
      <AuroraOrb
        state={
          (speaking
            ? "speaking"
            : listening === "command"
              ? "listening"
              : "idle") satisfies AuroraState
        }
        level={orbLevel}
      />
      {unread > 0 && !open ? (
        <span
          className="absolute -end-0.5 -top-0.5 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
          aria-label={t("unread", { count: unread })}
        >
          {unread}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      {open && minimized ? (
        /* the MINIMIZED pill: the conversation lives, the screen is yours */
        <div className={`fixed z-40 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 shadow-lg ${surfacePosition}`}>
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="text-xs font-semibold text-fg">{t("title")}</span>
          <button
            type="button"
            className="tap h-6 w-6 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label={t("restore")}
            title={t("restore")}
            onClick={() => setMinimized(false)}
          >
            ▣
          </button>
          <button
            type="button"
            className="tap h-6 w-6 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label={t("close")}
            onClick={() => { setOpen(false); setMinimized(false); }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {open && !minimized ? (
        <div className={`fixed z-40 flex w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl ${surfacePosition} ${panelHeight}`}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("title")}</span>
            {voiceStatus ? (
              <span className="text-[11px] text-accent">{voiceStatus}</span>
            ) : null}
            {/* the dial and the digest toggle live in Settings·Assistant
                now (user directive) — the dock carries conversation only */}
            <button
              type="button"
              className={`tap ms-auto h-7 w-7 rounded-md ${
                silent ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
              aria-label={t("silentLabel")}
              aria-pressed={silent}
              title={t("silentLabel")}
              onClick={toggleSilent}
            >
              {silent ? "🔇" : "🔊"}
            </button>
            {/* the EARS twin: listening on/off, next to the mouth toggle —
                off = same glyph, red slash, same quiet chrome as the speaker */}
            <button
              type="button"
              className={`tap inline-flex h-7 w-7 items-center justify-center rounded-md ${
                ears ? "text-fg-muted hover:bg-surface-2 hover:text-fg" : "bg-accent-soft text-fg-muted"
              }`}
              aria-label={t("earsLabel")}
              aria-pressed={!ears}
              title={t("earsLabel")}
              onClick={toggleEars}
            >
              <MicIcon slashed={!ears} />
            </button>
            <button
              type="button"
              className="tap h-7 w-7 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              aria-label={t("minimize")}
              title={t("minimize")}
              onClick={() => setMinimized(true)}
            >
              —
            </button>
            <button
              type="button"
              className="tap h-7 w-7 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="min-h-24 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {cards.length > 0 ? (
              <div className="space-y-1.5">
                {cards.slice(0, 4).map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`tap block w-full rounded-lg border px-2.5 py-1.5 text-start text-xs transition-colors ${
                      card.read
                        ? "border-border text-fg-muted hover:text-fg"
                        : "border-accent/40 bg-accent-soft text-fg"
                    }`}
                    onClick={() => openCard(card)}
                  >
                    {!card.read ? <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden /> : null}
                    {card.title}
                  </button>
                ))}
              </div>
            ) : null}
            {messages.length === 0 ? (
              <p className="text-sm leading-6 text-fg-muted">{t("empty")}</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-ee-sm bg-accent-soft px-3 py-2 text-sm leading-6 text-fg"
                        : "text-sm leading-6 text-fg"
                    }
                  >
                    {m.content}
                    {m.chips.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.chips.map((chip, i) => (
                          <span key={i} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                            {chip}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {m.failed ? (
                      <span className="mt-1 block text-xs text-warning">
                        {t("failed")}
                        {m.failedDetail ? <span className="block" dir="ltr">{m.failedDetail}</span> : null}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {consent ? (
              <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
                <p className="text-sm text-fg">{t("consentAsk", { action: consent.label })}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary h-8 min-h-0 px-3 text-xs"
                    onClick={() => consent.resolve(true)}
                  >
                    {t("allow")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary h-8 min-h-0 px-3 text-xs"
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
            className="flex items-end gap-2 border-t border-border p-2"
            onSubmit={(e) => { e.preventDefault(); send(); }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              className="input min-h-0 flex-1 resize-none py-2 text-sm"
              placeholder={t("placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button
              type="submit"
              className="btn-primary h-9 min-h-0 px-3 text-sm disabled:opacity-50"
              disabled={streaming || input.trim() === ""}
            >
              {streaming ? "…" : t("send")}
            </button>
          </form>
        </div>
      ) : null}

      {/* the toasts — every platform notice pops from the orb's head */}
      {/* every platform notice pops FROM THE BELL's corner (user directive,
          2026-08-22 — superseding pop-from-the-orb: the orb moved to the
          bar's centre and the bell is where notifications live) */}
      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed end-4 top-16 z-50 flex w-[min(88vw,20rem)] flex-col items-end gap-1.5 md:end-6">
          {toasts.map((notice) => (
            <p
              key={notice.id}
              role="status"
              className={`toast-from-bell rounded-xl border px-3 py-1.5 text-xs shadow-lg ${
                notice.kind === "warn"
                  ? "border-warning/40 bg-surface text-warning"
                  : "border-border bg-surface text-fg"
              }`}
            >
              {notice.text}
            </p>
          ))}
        </div>
      ) : null}

      {/* NO floating turn-state chip (user directive, 2026-08-22: "there is
          a notif still, remove it") — the orb's own animation states carry
          listening/speaking, and the panel header shows the word when open. */}

      {/* Portal the complete control—not only its canvas—so accessibility,
          unread state and interaction have one owner. Routes without the
          platform shell retain the exact fixed-corner fallback. */}
      {topbarPresenceHost
        ? createPortal(assistantButton, topbarPresenceHost)
        : assistantButton}
    </>
  );
}
