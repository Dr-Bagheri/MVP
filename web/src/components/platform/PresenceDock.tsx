"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { api } from "@/api/client";
import type { AgentCardItem, AgentEvent } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { executeClientTool, SURFACE_TOOLS } from "@/lib/agentSurface";
import { subscribeAssistantOpen } from "@/lib/assistantBus";
import { notify, subscribeNotify, type PlatformNotice } from "@/lib/notify";
import { useAudioLevel, useSyntheticPulse } from "@/lib/useAudioLevel";
import {
  currentSpeechAudio, isStopCommand, listenOnce, speak, startVoiceControl,
  stopSpeaking, subscribeSpeechPlayback, voiceInputSupported, type WakeListenerHandle,
} from "@/lib/voice";
import { AuroraOrb, type AuroraState } from "./AuroraOrb";

/**
 * PRESENCE (M34) — the agent, always there.
 *
 * One persistent dock on every route: a collapsed orb near the corner, a
 * panel when opened (Ctrl+E opens it anywhere), and the hub itself as the
 * maximized state — the orb hides on the hub route (the approved first
 * screen IS the presence), but the panel, the voice wake word and the
 * notification toasts stay live there: voice must work wherever the
 * person is standing.
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

export function PresenceDock() {
  const t = useTranslations("presence");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

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
  useEffect(() => subscribeSpeechPlayback(setSpeaking), []);
  /* the orb's breath: the REAL level when the M37 server voice plays (an
     analysable element), a graceful synthetic pulse for speechSynthesis
     and for the listening session (neither has a tappable stream) */
  const measuredLevel = useAudioLevel(speaking ? currentSpeechAudio() : null);
  const syntheticLevel = useSyntheticPulse(
    (speaking && currentSpeechAudio() === null) || listening === "command",
  );
  const orbLevel = measuredLevel > 0 ? measuredLevel : syntheticLevel;
  /**
   * Silent mode (user directive, 2026-08-21): ON = voice questions get
   * TEXT-only replies (and no spoken "Yes?"); OFF = spoken questions are
   * answered out loud. Listening is untouched either way — the toggle is
   * about the assistant's mouth, not its ears.
   */
  const [silent, setSilent] = useState(false);
  const silentRef = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("neurai-voice-silent") === "1";
      setSilent(stored);
      silentRef.current = stored;
    } catch { /* storage unavailable — voice stays on */ }
  }, []);

  function toggleSilent() {
    const next = !silentRef.current;
    silentRef.current = next;
    setSilent(next);
    try { localStorage.setItem("neurai-voice-silent", next ? "1" : "0"); } catch { /* fine */ }
    notify(next ? t("silentOn") : t("silentOff"));
  }
  const [toasts, setToasts] = useState<PlatformNotice[]>([]);
  const sessionId = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const wakeRef = useRef<WakeListenerHandle | null>(null);
  const micGrantedRef = useRef(false);
  /** the reply to a VOICE ask is spoken; typed asks stay silent */
  const speakReplyRef = useRef(false);
  const replyTextRef = useRef("");
  const streamingRef = useRef(false);
  /** the running ask, abortable by the spoken/typed STOP intent */
  const abortRef = useRef<AbortController | null>(null);

  /*
   * RELAY CAPTURE (2026-08-21): once the wake session is engaged, the
   * COMMAND is captured through the M38 live-stt relay instead of the
   * browser recognizer — Soniox hears Persian AND English in the same
   * sentence regardless of UI language (the browser model is locked to
   * one), and WE own the endpointing: 3s after the last word, the text
   * IS the command. The browser recognizer keeps running underneath as
   * the wake/stop trigger; its command finals are ignored while a relay
   * capture is active. If the relay is unavailable (503, no key), the
   * machine's own 3s interim-stability fallback still drives commands.
   */
  interface RelayCapture {
    id: string;
    stream: MediaStream;
    rec: MediaRecorder;
    es: EventSource;
    finals: string;
    interim: string;
    silence: ReturnType<typeof setTimeout> | null;
    done: boolean;
  }
  const captureRef = useRef<RelayCapture | null>(null);
  const relayDownRef = useRef(false);
  const CAPTURE_SILENCE_MS = 3000;

  function teardownCapture(cap: RelayCapture): void {
    if (cap.silence) clearTimeout(cap.silence);
    try { if (cap.rec.state !== "inactive") cap.rec.stop(); } catch { /* fine */ }
    cap.stream.getTracks().forEach((track) => track.stop());
    cap.es.close();
    void api.liveSttStop(cap.id).catch(() => undefined);
    if (captureRef.current === cap) captureRef.current = null;
  }

  function settleCapture(cap: RelayCapture): void {
    if (cap.done) return;
    cap.done = true;
    const text = `${cap.finals}${cap.interim}`.trim();
    teardownCapture(cap);
    if (text) routeCommand(text);
  }

  async function beginCapture(): Promise<void> {
    if (captureRef.current || relayDownRef.current) return;
    let sessionId: string;
    try {
      ({ session_id: sessionId } = await api.liveSttStart());
    } catch {
      relayDownRef.current = true; // machine fallback takes over, quietly
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      void api.liveSttStop(sessionId).catch(() => undefined);
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) void api.liveSttAudio(sessionId, event.data).catch(() => undefined);
    };
    rec.start(400);
    const es = new EventSource(`/api/live-stt/${encodeURIComponent(sessionId)}/events`);
    const cap: RelayCapture = { id: sessionId, stream, rec, es, finals: "", interim: "", silence: null, done: false };
    /*
     * The silence clock arms only once SOMETHING was said: pure silence
     * keeps the window open (the machine's 45s session decides), while a
     * spoken command settles CAPTURE_SILENCE_MS after its last word —
     * short commands end fast, long ones get all the room they need.
     */
    const armSilence = () => {
      if (cap.silence) clearTimeout(cap.silence);
      cap.silence = setTimeout(() => settleCapture(cap), CAPTURE_SILENCE_MS);
    };
    es.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data as string) as {
          type: string;
          tokens?: { text: string; is_final: boolean }[];
        };
        if (body.type === "closed" || body.type === "error") { settleCapture(cap); return; }
        if (body.type === "tokens" && body.tokens) {
          const finalText = body.tokens.filter((tok) => tok.is_final).map((tok) => tok.text).join("");
          if (finalText) cap.finals += finalText;
          cap.interim = body.tokens.filter((tok) => !tok.is_final).map((tok) => tok.text).join("");
          if (`${cap.finals}${cap.interim}`.trim()) armSilence();
        }
      } catch { /* not a caption frame */ }
    };
    captureRef.current = cap;
  }

  /** the universal STOP: cut the voice, abort the run — never a prompt */
  function localStop(): void {
    stopSpeaking();
    abortRef.current?.abort();
    setListening(null);
  }

  function routeCommand(text: string): void {
    if (isStopCommand(text)) { localStop(); return; }
    if (streamingRef.current) return; // one turn at a time
    setOpen(true);
    setMinimized(false);
    submitRef.current(text, true);
  }

  /* capture runs whenever the session is engaged and nothing else owns
     the moment — not while the assistant streams or speaks (it would
     transcribe the reply), and one capture at a time */
  useEffect(() => {
    if (listening === "command" && !streaming && !speaking && !captureRef.current) {
      void beginCapture();
    }
    if (listening !== "command" && captureRef.current) {
      // session over (stop word, timeout): whatever is mid-air is void
      const cap = captureRef.current;
      cap.done = true;
      teardownCapture(cap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, streaming, speaking]);

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

  const beginWake = useCallback(() => {
    if (!micGrantedRef.current || wakeRef.current || !voiceInputSupported()) return;
    /*
     * One continuous recognizer, one state machine (createWakeMachine).
     * The old shape — final-results-only plus a stop-the-listener/
     * listenOnce round-trip after the ack — was the delay the user felt:
     * the ack now fires on the INTERIM transcript and the command window
     * reads the same stream, no restart anywhere.
     */
    wakeRef.current = startVoiceControl({
      lang: locale === "fa" ? "fa-IR" : "en-US",
      onWake: () => {
        if (streamingRef.current) return; // one conversation turn at a time
        setOpen(true);
        setMinimized(false);
        if (!silentRef.current) speak(t("wakeAck"));
      },
      onCommand: (command) => {
        // while a relay capture is live, IT is the command channel — the
        // browser transcript would be a lower-quality duplicate
        if (captureRef.current) return;
        routeCommand(command);
      },
      onState: (state) => setListening(state === "engaged" ? "command" : null),
      onError: () => {
        wakeRef.current = null;
        notify(t("micDenied"), "warn");
      },
    });
  }, [locale, t]);
  const beginWakeRef = useRef(beginWake);
  beginWakeRef.current = beginWake;

  function suspendWake() {
    wakeRef.current?.stop();
    wakeRef.current = null;
  }

  /**
   * Ask for the microphone ON LANDING (user directive) — one getUserMedia,
   * tracks stopped immediately; the grant is what SpeechRecognition needs.
   * Denial → a toast at the orb's head asking for access.
   */
  useEffect(() => {
    if (!member) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    let live = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      if (!live) return;
      micGrantedRef.current = true;
      if (!voiceInputSupported()) {
        notify(t("voiceUnsupported"), "warn");
        return;
      }
      beginWakeRef.current();
    }).catch(() => {
      if (live) notify(t("micDenied"), "warn");
    });
    return () => {
      live = false;
      suspendWake();
      if (captureRef.current) {
        captureRef.current.done = true;
        teardownCapture(captureRef.current);
      }
    };
    // locale change restarts the listener with the right recognition lang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, locale, t]);

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
    replyTextRef.current = "";
    const replyId = `p-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: trimmed, chips: [] },
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
      for await (const event of stream) {
        await handleEvent(event, replyId);
      }
      // the reply to a spoken question is spoken — in ITS language —
      // unless silent mode says text only
      if (speakReplyRef.current && replyTextRef.current && !silentRef.current) {
        speak(replyTextRef.current);
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        // the person said STOP — keep whatever was already said, drop an
        // empty bubble; an interruption is not a failure
        setMessages((prev) => prev.filter((m) => !(m.id === replyId && m.content === "")));
      } else {
        const detail = (cause as { detail?: string }).detail;
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, failed: true, failedDetail: detail } : m)));
      }
    } finally {
      setStreaming(false);
      streamingRef.current = false;
      setConsent(null);
    }
  }
  submitRef.current = (question, viaVoice) => { void submit(question, viaVoice); };

  function send() {
    const question = input.trim();
    if (!question) return;
    setInput("");
    void submit(question, false);
  }

  /** the composer's mic: one utterance, sent by itself — no button press */
  function dictate() {
    if (!voiceInputSupported() || !micGrantedRef.current) {
      notify(micGrantedRef.current ? t("voiceUnsupported") : t("micDenied"), "warn");
      return;
    }
    suspendWake();
    setListening("command");
    const capture = listenOnce(locale === "fa" ? "fa-IR" : "en-US");
    if (!capture) { setListening(null); beginWakeRef.current(); return; }
    const timeout = setTimeout(() => capture.cancel(), 10000);
    void capture.done.then((heard) => {
      clearTimeout(timeout);
      setListening(null);
      beginWakeRef.current();
      if (heard) void submit(heard, true);
    });
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
        const result = await executeClientTool(event.tool, event.args, { push: router.push });
        // the surface action announces itself at the orb's head — "it
        // started doing it" must be visible, not inferred
        notify(event.label, result.ok ? "info" : "warn");
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

  return (
    <>
      {open && minimized ? (
        /* the MINIMIZED pill: the conversation lives, the screen is yours */
        <div className="fixed bottom-[104px] end-4 z-40 flex items-center gap-2 rounded-full md:bottom-[140px] md:end-6 border border-border bg-surface px-3 py-1.5 shadow-lg">
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
        <div className="fixed bottom-[104px] end-4 z-40 flex max-h-[70dvh] md:bottom-[140px] md:end-6 w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("title")}</span>
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
              type="button"
              className={`tap h-9 w-9 shrink-0 rounded-lg border text-sm ${
                listening === "command"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-fg-muted hover:border-accent hover:text-accent"
              }`}
              aria-label={t("micButton")}
              title={t("micButton")}
              onClick={dictate}
            >
              🎙
            </button>
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
      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed bottom-[104px] end-4 z-50 flex w-[min(88vw,20rem)] md:bottom-[140px] md:end-6 flex-col items-end gap-1.5">
          {toasts.map((notice) => (
            <p
              key={notice.id}
              role="status"
              className={`toast-from-orb rounded-xl border px-3 py-1.5 text-xs shadow-lg ${
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

      {listening === "command" ? (
        <p className="pointer-events-none fixed bottom-[104px] end-4 z-50 rounded-xl md:bottom-[140px] md:end-6 border border-accent/40 bg-surface px-3 py-1.5 text-xs text-accent shadow-lg">
          {t("listening")}
        </p>
      ) : null}

      {/* the orb, on EVERY route — the hub included (user directive,
          2026-08-21: "let the orb be present for the landing page as well",
          superseding the M34 hub-hides-the-orb reading) */}
      <button
        type="button"
        aria-label={t("openLabel")}
        title={`${t("openLabel")} (Ctrl+E)`}
        className="tap fixed bottom-4 end-4 z-40 block h-[38px] w-[38px] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:bottom-6 md:end-6 md:h-[52px] md:w-[52px]"
        onClick={() => {
          setMinimized(false);
          setOpen((v) => {
            const next = !v;
            if (next) setTimeout(() => inputRef.current?.focus(), 0);
            return next;
          });
        }}
      >
        {/* AURORA PULSE (user-supplied identity): the orb's whole body is
            decorative layers; this button is the one accessible thing */}
        <AuroraOrb
          state={
            (silent
              ? "muted"
              : speaking
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
    </>
  );
}
