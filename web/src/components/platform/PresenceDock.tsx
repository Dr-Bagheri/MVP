"use client";

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { api } from "@/api/client";
import type { AgentEvent } from "@/api/types";
import { useRouter } from "@/i18n/routing";
import { executeClientTool, SURFACE_TOOLS } from "@/lib/agentSurface";
import { subscribeAssistantOpen, subscribeRecordingLive } from "@/lib/assistantBus";
import { notify, subscribeNotify, type PlatformNotice } from "@/lib/notify";
import { Icon } from "@/components/icons";
import { useAudioLevel, useSyntheticPulse } from "@/lib/useAudioLevel";
import {
  currentSpeechAudio, speak, speakQueued, stopSpeaking, subscribeSpeechPlayback,
} from "@/lib/voice";
import { startVoiceLoop, voiceLoopSupported, type VoiceLoopHandle } from "@/lib/voiceLoop";
import dynamic from "next/dynamic";
import type { AuroraState } from "./EchoEOrb";
/*
 * The orb's renderer is three.js — 560,777 B, the single largest thing web/
 * ships, and the only importer of `three` in the repo. This dock is imported
 * statically by the root layout, so a static import here put the whole engine
 * in EVERY route's first-load set: 37 of 38 routes, including the seven where
 * `orbIsSilentOn` returns true and this component renders nothing at all.
 * Loading it on demand moves the engine to the routes that actually draw it.
 * Measured: 37 of 38 routes carried it before, 0 of 38 after, and mean
 * first-load JS went 1,169,873 -> 656,798 B.
 *
 * `ssr: false` here — unlike the Settings and Echo section splits, where it
 * was measured to buy nothing — because it also keeps three.js out of the
 * SERVER bundle, and costs no first paint: the dock renders nothing at all
 * until `identityState()` answers, so the orb has always appeared after
 * hydration rather than in the HTML.
 */
const AuroraOrb = dynamic(() => import("./EchoEOrb").then((m) => m.EchoEOrb), { ssr: false });
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
 * reset the panel or the voice wake word.
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

/** where the orb is pinned, and what SHAPE the assistant takes there */
interface OrbPin {
  x: number;
  y: number;
  /** float = the popup card; a side mode seats the orb in its holder */
  mode: "float" | "side-left" | "side-right";
}

/** how close to a side a release must land to dock there, in px */
const EDGE = 72;

/**
 * ONE sizing rule for every control in the panel's header (user report,
 * 2026-08-29: "put the speaker icon in orb AI in center vertically also").
 *
 * The cause was not a stray margin. A `<button>` is `inline-block` and
 * `.icon` is `inline-grid`, so an icon sitting alone in a button is laid
 * out as INLINE CONTENT: its bottom edge lands on the text baseline, and
 * the line box keeps descender space underneath it. The glyph therefore
 * rides high inside its 28px box. The ears button had been written with
 * `inline-flex items-center justify-center` and was centred; the speaker,
 * the new-conversation plus and the close ✕ had not, and were not — so
 * the speaker read as misaligned against the one sibling that was right.
 *
 * Fixed at the CLASS rather than at the instance (the `.btn`/`.tap`
 * precedent: stop the claim being local). A header control that opts out
 * of this constant is a visible edit, not an invisible omission —
 * PresenceDock.header.test.tsx asserts they all share it.
 *
 * `ms-auto` and the state colours stay OUT of it: this constant is the
 * box and what it does to its contents, not where the box sits or what
 * colour it is.
 */
export const DOCK_HEADER_BUTTON =
  "tap inline-flex h-7 w-7 items-center justify-center rounded-md";

/**
 * THE HOLDER's geometry (user directive, 2026-08-26): a solid circle at the
 * screen edge, seventy percent of it visible — the socket the orb sits in —
 * with a rail line running from the top bar to the end of the page,
 * interrupted by the socket. SOCKET matches the orb's own diameter so the
 * seated orb fills its holder exactly; SOCKET_CX is the circle's centre
 * measured from the edge: visible width minus the radius.
 */
const SOCKET = 64;
const SOCKET_CX = Math.round(SOCKET * 0.7 - SOCKET / 2); // 13px in

/**
 * The one side that holds a dock: the OPPOSITE of the menu rail (user
 * directive, 2026-08-26 — "just one side bar, the one opposite side of the
 * menu bar"). The rail sits at inline-start, so the holder is at
 * inline-end: right in LTR, left in RTL.
 */
export function holderSideFor(dir: string): "side-left" | "side-right" {
  return dir === "rtl" ? "side-left" : "side-right";
}

/**
 * Where a released orb docks. Exported for the tests — the drag itself
 * needs a signed-in member and a real pointer, but THIS is the decision.
 * Only the holder's own side docks; the menu's side and the bottom are
 * plain floating space.
 */
export function dockModeFor(
  x: number,
  width: number,
  allowed: "side-left" | "side-right",
): OrbPin["mode"] {
  if (allowed === "side-left" && x < EDGE) return "side-left";
  if (allowed === "side-right" && x > width - EDGE) return "side-right";
  return "float";
}

/** the orb's home (user directive, 2026-08-26): seated in the holder, not
    the top-bar cradle — the cradle is where it CAME from, not where it
    lives */
function defaultSidePin(): OrbPin {
  const mode = holderSideFor(document.documentElement.dir);
  return {
    mode,
    x: mode === "side-left" ? SOCKET_CX : window.innerWidth - SOCKET_CX,
    y: Math.round(window.innerHeight * 0.42),
  };
}

/** the orb's resting spot: a side dock SEATS it in the holder's socket —
    centre on the socket's centre, so orb and holder read as one thing */
function orbStyle(
  pin: OrbPin,
  drag: { x: number; y: number } | null,
): CSSProperties {
  if (drag) return { left: drag.x, top: drag.y };
  if (pin.mode === "side-left") return { left: SOCKET_CX, top: pin.y };
  if (pin.mode === "side-right") {
    return { left: window.innerWidth - SOCKET_CX, top: pin.y };
  }
  return { left: pin.x, top: pin.y };
}

/** the socket's y, kept clear of the top bar and the page edge */
function clampSocketY(y: number): number {
  return Math.min(Math.max(y, 120), window.innerHeight - 72);
}

/**
 * The holder itself: rail line above, socket, rail line below — top bar to
 * the end of the page. Rendered on BOTH sides while the orb is being
 * dragged (the drop targets showing themselves), and on the docked side
 * alone once the orb is seated. Decorative and pointer-transparent: the
 * drop is decided by the release point, never by hitting this drawing.
 */
export function DockHolder({ side, y, active }: {
  side: "left" | "right";
  y: number;
  active: boolean;
}) {
  const cy = clampSocketY(y);
  const cyLocal = cy - 56; // the container starts under the 56px top bar
  const lineColor = active ? "rgb(var(--accent))" : "rgb(var(--border-strong) / 0.55)";
  const lineX = { [side]: SOCKET_CX - 1 } as CSSProperties;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-0 top-14 z-30"
      style={{ [side]: 0, width: 76 } as CSSProperties}
    >
      {/* the rail, from the top menu to the socket */}
      <span
        className="absolute w-0.5 rounded-full transition-colors"
        style={{ ...lineX, top: 0, height: Math.max(0, cyLocal - SOCKET / 2 - 6), background: lineColor }}
      />
      {/* the socket — a solid circle, 70% of it on screen */}
      <span
        className="absolute rounded-full border-2 transition-all"
        style={{
          [side]: SOCKET_CX - SOCKET / 2,
          top: cyLocal - SOCKET / 2,
          width: SOCKET,
          height: SOCKET,
          background: "rgb(var(--surface-2))",
          borderColor: active ? "rgb(var(--accent))" : "rgb(var(--border-strong) / 0.7)",
          boxShadow: active ? "0 0 22px rgb(var(--accent) / 0.45)" : "none",
        } as CSSProperties}
      />
      {/* the rail, from the socket to the end of the page */}
      <span
        className="absolute w-0.5 rounded-full transition-colors"
        style={{ ...lineX, top: cyLocal + SOCKET / 2 + 6, bottom: 0, background: lineColor }}
      />
    </div>
  );
}


/**
 * Where the orb does NOT appear. One list, three reasons, each a directive:
 *
 *  - **the platform control** (2026-08-23) is the vendor's operations room,
 *    not the product;
 *  - **auth surfaces** (2026-08-25) are the door, not the room — the orb was
 *    rendering in the sign-in page's corner;
 *  - **the assistant's own surfaces** (2026-08-27: "when you go history, the
 *    main ai assistant should be open not the orb"). The orb is presence in
 *    rooms the assistant does not own. On the assistant, a conversation's
 *    history, workflows, integrations and agents, the assistant IS the page,
 *    and an orb there is a second door to the room you are standing in — one
 *    whose panel covers the thing it duplicates.
 *
 * A pure function so the rule can be asserted without mounting the dock, and
 * so adding a surface is one entry rather than a fourth early return.
 */
export function orbIsSilentOn(pathname: string): boolean {
  const route = pathname.replace(/^\/(fa|en)(?=\/|$)/, "") || "/";
  if (/^\/platform(\/|$)/.test(route)) return true;
  if (/^\/(sign-in|sign-up|reset|forgot|pending|suspended)(\/|$)/.test(route)) return true;
  /* `/` is the assistant's own door — it redirects there */
  if (route === "/") return true;
  return /^\/(assistant|conversations|workflows|agents|integrations)(\/|$)/.test(route);
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
  const openRef = useRef(false);
  openRef.current = open;
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<DockMessage[]>([]);

  /**
   * A fresh thread, not an erasure: the dock forgets which conversation it
   * was resuming and starts a new one on the next ask. The old conversation
   * is untouched — it stays under Assistant → History, where archiving
   * lives. A "clear" that deleted the record would be the dock deciding
   * what the history says.
   */
  function freshConversation(): void {
    abortRef.current?.abort();
    setMessages([]);
    sessionId.current = undefined;
    notify(t("newConversationStarted"));
  }

  /**
   * CLOSING ENDS THE CONVERSATION (user directive, 2026-08-26: "nothing
   * should remain here as a history"). The ✕ resets the thread silently —
   * the next open is clean, and what was said lives on as a conversation
   * under Assistant → History, deletable there like any other.
   */
  function closeDock(): void {
    abortRef.current?.abort();
    setMessages([]);
    sessionId.current = undefined;
    setOpen(false);
  }

  /** a toggle-open starts CLEAN (user report, 2026-08-26: "i still can see
      ai assistant thread" — a close path that only hid the panel left the
      thread in memory): unless a reply is mid-stream, whatever the last
      conversation left behind is dropped — it already lives under
      Assistant → History. A deliberate open from history loads its
      session through subscribeAssistantOpen, not through here. */
  function openFresh(): void {
    if (!streamingRef.current) {
      setMessages([]);
      sessionId.current = undefined;
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  const [streaming, setStreaming] = useState(false);
  const [consent, setConsent] = useState<
    | null
    | { label: string; resolve: (allowed: boolean) => void }
  >(null);
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
  /**
   * DRAG-TO-PIN (user directive, 2026-08-25): the orb's home is the top
   * bar's cradle, and dragging it anywhere else pins it there — remembered
   * across loads. Dragging it back ONTO the bar clears the pin: the default
   * position is the top menu, not wherever it happened to be released.
   */
  const [pin, setPin] = useState<OrbPin | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("neurai-orb-pin");
      if (!raw) {
        // no saved spot = HOME: seated in the side holder (2026-08-26)
        setPin(defaultSidePin());
        return;
      }
      const parsed = JSON.parse(raw) as OrbPin;
      const allowed = holderSideFor(document.documentElement.dir);
      if (parsed.mode === "side-left" || parsed.mode === "side-right") {
        // a docked pin always seats on the ALLOWED side — one saved under
        // the other locale's direction (or the removed two-side build)
        // comes home rather than docking over the menu
        setPin({
          ...defaultSidePin(),
          y: Math.min(Math.max(parsed.y, 120), window.innerHeight - 72),
          mode: allowed,
        });
        return;
      }
      // a float pin, clamped back into this viewport ("bottom" from the
      // one-day build lands here too, as a float)
      setPin({
        x: Math.min(Math.max(parsed.x, 32), window.innerWidth - 32),
        y: Math.min(Math.max(parsed.y, 80), window.innerHeight - 32),
        mode: "float",
      });
    } catch {
      /* storage unavailable — home still applies */
      setPin(defaultSidePin());
    }
  }, []);

  /**
   * The drag rides WINDOW listeners, not pointer capture: lifting the orb
   * out of the cradle moves the button between a portal and a fixed node —
   * a REMOUNT — and captured pointer events die with the old node.
   */
  function onOrbPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved
          && Math.abs(ev.clientX - start.x) < 6 && Math.abs(ev.clientY - start.y) < 6) {
        return; // a jittery click is still a click
      }
      moved = true;
      setDrag({ x: ev.clientX, y: ev.clientY });
      setPin((p) => p ?? { x: ev.clientX, y: ev.clientY, mode: "float" }); // lift out of the cradle
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragCleanupRef.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!moved) return; // plain click — onClick handles it
      suppressClickRef.current = true;
      setDrag(null);
      // released on the top bar = go HOME — and home is the side holder
      // now, not the cradle it came from
      if (ev.clientY < 72) {
        const home = defaultSidePin();
        setPin(home);
        try { localStorage.setItem("neurai-orb-pin", JSON.stringify(home)); } catch { /* fine */ }
        return;
      }
      /*
       * THE SIDES ARE HOLDERS (user directive, 2026-08-26): released
       * against a side, the orb seats into the socket drawn there and the
       * side panel opens at once — putting it in the holder IS asking for
       * the menu. Anywhere else stays the floating pin.
       */
      const mode = dockModeFor(
        ev.clientX, window.innerWidth,
        holderSideFor(document.documentElement.dir));
      const seated = mode !== "float";
      const next: OrbPin = {
        x: Math.min(Math.max(ev.clientX, 32), window.innerWidth - 32),
        y: seated
          ? clampSocketY(ev.clientY)
          : Math.min(Math.max(ev.clientY, 80), window.innerHeight - 32),
        mode,
      };
      setPin(next);
      try { localStorage.setItem("neurai-orb-pin", JSON.stringify(next)); } catch { /* fine */ }
      if (seated) {
        setOpen(true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanupRef.current = cleanup;
  }

  /** the open panel hangs off the pin, on whichever side has room —
      or, in a docked mode, takes the whole edge */
  function pinnedPanelStyle(): CSSProperties {
    if (!pin) return {};
    if (pin.mode === "side-left" || pin.mode === "side-right") {
      /* 76px in from the edge: the holder's strip stays visible, with the
         seated orb in it — the panel appears BESIDE its holder, not over
         the thing that opened it */
      return {
        position: "fixed",
        top: 64,
        bottom: 8,
        ...(pin.mode === "side-left" ? { left: 76 } : { right: 76 }),
      };
    }
    const below = pin.y < window.innerHeight / 2;
    const startHalf = pin.x < window.innerWidth / 2;
    return {
      position: "fixed",
      ...(below
        ? { top: Math.min(pin.y + 44, window.innerHeight - 160) }
        : { bottom: Math.min(window.innerHeight - pin.y + 44, window.innerHeight - 160) }),
      ...(startHalf
        ? { left: Math.max(8, pin.x - 32) }
        : { right: Math.max(8, window.innerWidth - pin.x - 32) }),
    };
  }
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
    setMessages([]);
    sessionId.current = undefined;
    setOpen(false);
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

  /** NOTHING resumes here (user directive, 2026-08-26): the panel opens
      clean every time, and the conversations it creates live in
      Assistant → History — the one place history is read and deleted */

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
        if (openRef.current) closeDock();
        else openFresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

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
      if (request.sessionId) void loadSession(request.sessionId);
      if (request.draft) {
        // the composer is uncontrolled — fill after the pane mounts; a
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
   * Adopt a STORED conversation as the dock's thread — its messages loaded,
   * new questions continuing it. This replaced routing to /conversations:
   * with the docked pane gone everywhere, the dock is the reader.
   */
  async function loadSession(id: string) {
    sessionId.current = id;
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
  /**
   * HALF-DUPLEX (2026-08-26, after the dock interviewed itself): while the
   * assistant's voice plays, the mic is fully muted — and it stays muted
   * for a beat after playback ends, because the transcriber's tail arrives
   * AFTER the audio stops and that tail is our own last words.
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

  /* the agent's cards LEFT the dock (user directive, 2026-08-26: "all
     things done by ai assistant must just go to history") — the bell
     announces them, history holds them; the panel opens clean. */

  const askConsent = useCallback((label: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConsent({ label, resolve });
    });
  }, []);

  async function submit(question: string, viaVoice: boolean) {
    const trimmed = question.trim();
    if (!trimmed || streamingRef.current) return;
    setOpen(true);
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
  /* the loop above keeps running wherever the orb is silent: the ears
     survive a visit to a surface that shows no orb, and only the RENDERING
     stands down. */
  if (orbIsSilentOn(pathname)) return null;

  /* the small ring pokes ~21/24px below the 56px bar — surfaces hang just
     under that (user redesign, 2026-08-22). A PINNED orb gets its panel
     beside wherever it was dragged (computed at open time). */
  const surfacePosition = pin
    ? "" // inline style below
    : "left-1/2 top-[88px] -translate-x-1/2 md:top-[92px]";
  /*
   * The panel's SHAPE follows the dock mode: a side dock is a full-height
   * column beside its holder; the float/cradle keeps the compact card it
   * has always been. The width/height cannot ride the inline style — they
   * are the difference between "a popup" and "a panel".
   */
  const dockMode = pin?.mode ?? "float";
  const panelShape =
    dockMode === "side-left" || dockMode === "side-right"
      ? "w-[min(86vw,26rem)] h-auto"
      : "w-[min(92vw,24rem)]";
  const panelHeight = dockMode === "float" ? "max-h-[calc(100dvh-7rem)]" : "";

  const orbVisual = (
    <>
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
    </>
  );

  const assistantButton = (
    <button
      type="button"
      data-tour="orb"
      aria-label={t("openLabel")}
      title={`${t("openLabel")} (Ctrl+E)`}
      className={
        pin
          ? "tap fixed z-40 block h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          : "tap relative z-10 block h-full w-full touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      }
      style={pin ? orbStyle(pin, drag) : undefined}
      onPointerDown={onOrbPointerDown}
      onClick={() => {
        // a drag's mouse-up must not also open the panel
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if (open) closeDock();
        else openFresh();
      }}
    >
      {/* The particle field is decorative; this button remains the single
          accessible and interactive assistant control in either location.
          Silent mode deliberately does NOT reach the orb (user ruling,
          2026-08-22: "the particles must move all the time — it does not
          depend on anything"): silent is about the VOICE, and the frozen
          orb read as a dead assistant. The orb's "muted" state stays in
          its contract, unused by this consumer. */}
      {orbVisual}
    </button>
  );

  return (
    <>
      {/* the holder: ONE side only — the opposite of the menu rail. While
          the orb is in hand it shows its socket at the pointer's height,
          lit when the pointer is in the zone; once seated it stays under
          the orb */}
      {drag !== null ? (
        holderSideFor(document.documentElement.dir) === "side-left" ? (
          <DockHolder side="left" y={drag.y} active={drag.x < EDGE} />
        ) : (
          <DockHolder side="right" y={drag.y} active={drag.x > window.innerWidth - EDGE} />
        )
      ) : pin && pin.mode !== "float" ? (
        <DockHolder
          side={pin.mode === "side-left" ? "left" : "right"}
          y={pin.y}
          active={false}
        />
      ) : null}

      {/* minimize is GONE (user directive, 2026-08-26): the panel is
          either open or closed — the orb itself is the small state, so a
          third in-between pill was one idea wearing two controls */}
      {open ? (
        <div
          className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl ${panelShape} ${surfacePosition} ${panelHeight}`}
          style={pin ? pinnedPanelStyle() : undefined}
        >
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
              className={`${DOCK_HEADER_BUTTON} ms-auto ${
                silent ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
              aria-label={t("silentLabel")}
              aria-pressed={silent}
              title={t("silentLabel")}
              onClick={toggleSilent}
            >
              {/* the theme's OFF state, not an emoji (user report,
                  2026-08-26: "the icons on top of the orb are out of
                  shape — use the theme icons"). An emoji is a font's
                  drawing, not ours: it carries its own weight, its own
                  colour and its own box, and renders differently on every
                  platform. `<Icon off>` is the same speaker glyph under
                  the theme's red slash. */}
              <Icon name="speaker" size="md" off={silent} />
            </button>
            {/* the EARS twin: listening on/off, next to the mouth toggle —
                off = same glyph, red slash, same quiet chrome as the speaker */}
            <button
              type="button"
              className={`${DOCK_HEADER_BUTTON} ${
                ears ? "text-fg-muted hover:bg-surface-2 hover:text-fg" : "bg-accent-soft text-fg-muted"
              }`}
              aria-label={t("earsLabel")}
              aria-pressed={!ears}
              title={t("earsLabel")}
              onClick={toggleEars}
            >
              <Icon name="mic" size="md" off={!ears} />
            </button>
            {/* a FRESH conversation (user ask, 2026-08-26: "where can I
                clean up this history"): the dock's thread resets here —
                nothing is deleted; the old conversation stays readable
                under Assistant → History, where archiving lives */}
            <button
              type="button"
              className={`${DOCK_HEADER_BUTTON} text-fg-muted hover:bg-surface-2 hover:text-fg`}
              aria-label={t("newConversation")}
              title={t("newConversation")}
              onClick={freshConversation}
            >
              <Icon name="plus" size="md" />
            </button>
            <button
              type="button"
              className={`${DOCK_HEADER_BUTTON} text-fg-muted hover:bg-surface-2 hover:text-fg`}
              aria-label={t("close")}
              onClick={closeDock}
            >
              <Icon name="close" size="md" />
            </button>
          </div>

          <div className="min-h-24 flex-1 space-y-3 overflow-y-auto px-3 py-3">
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
          state and interaction have one owner. A PINNED orb renders
          fixed at its pin instead. The old fixed-corner fallback is GONE
          (user directive, 2026-08-25): no anchor and no pin = no orb —
          "any trace of it beside the right position it has at the top". */}
      {pin
        ? assistantButton
        : topbarPresenceHost
          ? createPortal(assistantButton, topbarPresenceHost)
          : null}
    </>
  );
}
