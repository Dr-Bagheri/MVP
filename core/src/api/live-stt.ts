/**
 * M38 — the LIVE TRANSCRIPTION RELAY (user directive, 2026-08-21: "build
 * the relay lane for the live transcription").
 *
 * The browser must never hold the Soniox key (the invariant that deferred
 * this feature), so the realtime socket lives HERE: the browser posts
 * audio chunks through the BFF, this relay holds one outbound WebSocket
 * per session to Soniox's realtime endpoint, and captions ride back to
 * the browser as SSE. Chunked-POST-up / SSE-down instead of a browser
 * WebSocket, deliberately: the BFF already proxies SSE (the assistant's
 * lane), Vercel functions cannot proxy WebSockets, and a browser WS to
 * core would need its own ticket auth for a cookie the BFF already
 * carries.
 *
 * Sessions are in-memory and OWNED: every touch requires the starting
 * user's id, and unknown/expired/foreign ids are one indistinguishable
 * "no such session" (the broker precedent). Caps: 3 live sessions per
 * user, 120s idle reap. Captions are CONTENT — they cross the wire to
 * their owner and never enter a log (invariant 7).
 */

import { randomUUID } from "node:crypto";

const SONIOX_RT_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

export interface LiveToken {
  text: string;
  is_final: boolean;
}

export type LiveEvent =
  | { type: "tokens"; tokens: LiveToken[] }
  | { type: "error"; code: string }
  | { type: "closed" };

interface LiveSession {
  id: string;
  userId: string;
  ws: WsLike;
  /** events queued while no reader is attached; a reader drains then follows */
  queue: LiveEvent[];
  reader: ((event: LiveEvent) => void) | null;
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout>;
}

/** WebSocket-shaped, injectable for tests (Node 22's global otherwise). */
export interface WsLike {
  readyState: number;
  send: (data: string | Uint8Array) => void;
  close: () => void;
  addEventListener: (type: string, fn: (event: never) => void) => void;
}

export interface LiveSttOptions {
  apiKey?: string | undefined;
  url?: string;
  model?: string;
  wsCtor?: (new (url: string) => WsLike) | undefined;
  idleMs?: number;
  maxPerUser?: number;
}

export function createLiveStt(options: LiveSttOptions = {}) {
  const apiKey = options.apiKey ?? process.env.SONIOX_API_KEY;
  const url = options.url ?? SONIOX_RT_URL;
  const model = options.model ?? process.env.SONIOX_RT_MODEL ?? "stt-rt-preview";
  const idleMs = options.idleMs ?? 120_000;
  const maxPerUser = options.maxPerUser ?? 3;
  const sessions = new Map<string, LiveSession>();

  function push(session: LiveSession, event: LiveEvent): void {
    if (session.reader) session.reader(event);
    else {
      session.queue.push(event);
      if (session.queue.length > 500) session.queue.shift(); // captions, not a ledger
    }
  }

  function reap(session: LiveSession): void {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(session.idleTimer);
    try { session.ws.close(); } catch { /* already gone */ }
    push(session, { type: "closed" });
    sessions.delete(session.id);
  }

  function touch(session: LiveSession): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => reap(session), idleMs);
  }

  /** owned lookup: foreign and unknown ids are ONE answer */
  function owned(id: string, userId: string): LiveSession | null {
    const session = sessions.get(id);
    return session && session.userId === userId && !session.closed ? session : null;
  }

  return {
    available: () => Boolean(apiKey),

    start(userId: string): { session_id: string } {
      if (!apiKey) throw new Error("live stt unavailable — no provider key");
      const mine = [...sessions.values()].filter((s) => s.userId === userId);
      if (mine.length >= maxPerUser) {
        // the oldest yields — a refresh mid-recording must not brick the lane
        reap(mine[0]!);
      }
      const Ctor = (options.wsCtor ?? (globalThis.WebSocket as unknown as new (u: string) => WsLike));
      const ws: WsLike = new Ctor(url);
      const session: LiveSession = {
        id: randomUUID(),
        userId,
        ws,
        queue: [],
        reader: null,
        closed: false,
        idleTimer: setTimeout(() => undefined, 0),
      };
      touch(session);
      ws.addEventListener("open", (() => {
        /*
         * The provider's spelling (their realtime contract): first message
         * is the JSON config, then binary audio, then an empty string to
         * end. audio_format "auto" lets the browser send what
         * MediaRecorder produces (webm/opus) without a PCM pipeline.
         */
        ws.send(JSON.stringify({
          api_key: apiKey,
          model,
          audio_format: "auto",
          language_hints: ["fa", "en"],
          enable_language_identification: true,
        }));
      }) as never);
      ws.addEventListener("message", ((event: { data: unknown }) => {
        try {
          const body = JSON.parse(String(event.data)) as {
            tokens?: { text?: string; is_final?: boolean }[];
            error_code?: number | string;
          };
          if (body.error_code !== undefined) {
            // code only — the message could quote audio content
            push(session, { type: "error", code: String(body.error_code) });
            reap(session);
            return;
          }
          if (Array.isArray(body.tokens) && body.tokens.length > 0) {
            push(session, {
              type: "tokens",
              tokens: body.tokens.map((token) => ({
                text: String(token.text ?? ""),
                is_final: token.is_final === true,
              })),
            });
          }
        } catch { /* a non-JSON frame — nothing to surface */ }
      }) as never);
      ws.addEventListener("close", (() => reap(session)) as never);
      ws.addEventListener("error", (() => {
        push(session, { type: "error", code: "provider_socket" });
        reap(session);
      }) as never);
      sessions.set(session.id, session);
      return { session_id: session.id };
    },

    /** binary audio straight through; false = no such session (one answer) */
    pushAudio(id: string, userId: string, bytes: Uint8Array): boolean {
      const session = owned(id, userId);
      if (!session) return false;
      touch(session);
      if (session.ws.readyState === 0 /* CONNECTING */) {
        // the socket is still opening — a first chunk racing the handshake
        // waits for open rather than being dropped on the floor
        session.ws.addEventListener("open", (() => {
          try { session.ws.send(bytes); } catch { /* closed in between */ }
        }) as never);
        return true;
      }
      try { session.ws.send(bytes); } catch { return false; }
      return true;
    },

    /** attach ONE reader; queued events drain first. Returns detach. */
    subscribe(id: string, userId: string, reader: (event: LiveEvent) => void): (() => void) | null {
      const session = owned(id, userId);
      if (!session) return null;
      touch(session);
      for (const event of session.queue.splice(0)) reader(event);
      session.reader = reader;
      return () => { if (session.reader === reader) session.reader = null; };
    },

    stop(id: string, userId: string): boolean {
      const session = owned(id, userId);
      if (!session) return false;
      try { session.ws.send(""); } catch { /* already closing */ }
      // the provider flushes finals then closes; the close handler reaps.
      // A provider that never closes is caught by the idle reaper.
      touch(session);
      return true;
    },

    /** visible for tests */
    liveSessions: () => sessions.size,
  };
}

export type LiveStt = ReturnType<typeof createLiveStt>;
