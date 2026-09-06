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
  /**
   * The language the provider identified for this token (2026-09-06, C2) —
   * present when identification is on and the provider said; absent means
   * "not said", never a default. A caption line sets its direction from it.
   */
  language?: string;
  /**
   * The provider's speaker label for this token — present only on the
   * RECORDING lane, which asks for diarization (2026-08-26). Absent means
   * "this lane does not diarize", never "one speaker": a consumer that
   * counts must count the labels it actually receives.
   *
   * Normalized to a string HERE, at the only layer that knows the
   * provider spells it as a number: the wire carries one spelling.
   */
  speaker?: string;
}

export type LiveEvent =
  | { type: "tokens"; tokens: LiveToken[] }
  | { type: "error"; code: string }
  | { type: "closed" };

interface LiveSession {
  id: string;
  userId: string;
  /** a per-session CAPABILITY: lets the browser stream audio/read captions
      for THIS session directly (skipping the BFF hop that cost seconds of
      transcript lag) without ever holding the user's token — it grants
      nothing beyond this one ephemeral transcription stream */
  ticket: string;
  ws: WsLike;
  /** events queued while no reader is attached; a reader drains then follows */
  queue: LiveEvent[];
  reader: ((event: LiveEvent) => void) | null;
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout>;
  /** when it opened — the lifetime is the one number that tells a churn from a call */
  startedAt: number;
  /** the client asked for the end; the provider's close is then "stopped", not a fault */
  stopping: boolean;
  format: "pcm16k" | "auto";
}

/** why a session ended — codes only, never the provider's sentence */
export type LiveEndReason =
  | "stopped" | "idle" | "cap" | "provider_error" | "provider_socket" | "provider_closed";

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
  /**
   * WHERE AN END IS WRITTEN DOWN (2026-09-06). For ten hours on 2026-09-05/06
   * the provider socket failed on every session (a handshake that never
   * completed) and the only trace in the api log was 77,000 "write after
   * end" errors — the relay pushed the reason to the browser and told the
   * server nothing, so the log could not name which nothing it was. A
   * provider fault is a WARN with its reason and code; the ordinary ends are
   * INFO. Codes only: the provider's message can quote audio.
   */
  log?: {
    info: (fields: Record<string, unknown>, msg: string) => void;
    warn: (fields: Record<string, unknown>, msg: string) => void;
  } | undefined;
}

export function createLiveStt(options: LiveSttOptions = {}) {
  const apiKey = options.apiKey ?? process.env.SONIOX_API_KEY;
  const url = options.url ?? SONIOX_RT_URL;
  const model = options.model ?? process.env.SONIOX_RT_MODEL ?? "stt-rt-preview";
  const idleMs = options.idleMs ?? 120_000;
  const maxPerUser = options.maxPerUser ?? 3;
  const sessions = new Map<string, LiveSession>();

  function deliver(session: LiveSession, event: LiveEvent): void {
    if (session.reader) session.reader(event);
    else {
      session.queue.push(event);
      if (session.queue.length > 500) session.queue.shift(); // captions, not a ledger
    }
  }

  /**
   * A REAPED SESSION IS SILENT. `closed` is the last thing a subscriber
   * hears and the reader ends its response on it; the provider socket keeps
   * firing after we closed it (undici fires `error` and `close` in either
   * order on a failed handshake), and every one of those late pushes used to
   * reach an ended response — the "write after end" in the log. Only reap
   * itself may deliver after the flag is set, and only the one event.
   */
  function push(session: LiveSession, event: LiveEvent): void {
    if (session.closed) return;
    deliver(session, event);
  }

  function reap(session: LiveSession, reason: LiveEndReason, code?: string): void {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(session.idleTimer);
    try { session.ws.close(); } catch { /* already gone */ }
    deliver(session, { type: "closed" });
    sessions.delete(session.id);
    const fields = {
      reason,
      ...(code === undefined ? {} : { code }),
      lifetime_ms: Date.now() - session.startedAt,
      format: session.format,
      live_sessions: sessions.size,
    };
    if (reason === "provider_error" || reason === "provider_socket") {
      options.log?.warn(fields, "live_stt_session_ended");
    } else {
      options.log?.info(fields, "live_stt_session_ended");
    }
  }

  function touch(session: LiveSession): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => reap(session, "idle"), idleMs);
  }

  /** owned lookup: foreign and unknown ids are ONE answer */
  function owned(id: string, userId: string): LiveSession | null {
    const session = sessions.get(id);
    return session && session.userId === userId && !session.closed ? session : null;
  }

  /** the ticket path: same one-answer discipline — wrong ticket = no session */
  function byTicket(id: string, ticket: string): LiveSession | null {
    const session = sessions.get(id);
    return session && ticket !== "" && session.ticket === ticket && !session.closed
      ? session : null;
  }

  function doPush(session: LiveSession | null, bytes: Uint8Array): boolean {
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
  }

  function doSubscribe(
    session: LiveSession | null,
    reader: (event: LiveEvent) => void,
  ): (() => void) | null {
    if (!session) return null;
    touch(session);
    for (const event of session.queue.splice(0)) reader(event);
    session.reader = reader;
    return () => { if (session.reader === reader) session.reader = null; };
  }

  return {
    available: () => Boolean(apiKey),

    start(
      userId: string,
      format?: "pcm16k",
      /** recognition context (2026-09-06): the org's names and jargon, read
          by the route under the person's identity; absent = none sent */
      context?: { terms: string[]; text?: string; general?: { key: string; value: string }[] },
    ): { session_id: string; ticket: string } {
      if (!apiKey) throw new Error("live stt unavailable — no provider key");
      const mine = [...sessions.values()].filter((s) => s.userId === userId);
      if (mine.length >= maxPerUser) {
        // the oldest yields — a refresh mid-recording must not brick the lane
        reap(mine[0]!, "cap");
      }
      const Ctor = (options.wsCtor ?? (globalThis.WebSocket as unknown as new (u: string) => WsLike));
      const ws: WsLike = new Ctor(url);
      const session: LiveSession = {
        id: randomUUID(),
        userId,
        ticket: randomUUID(),
        ws,
        queue: [],
        reader: null,
        closed: false,
        idleTimer: setTimeout(() => undefined, 0),
        startedAt: Date.now(),
        stopping: false,
        format: format === "pcm16k" ? "pcm16k" : "auto",
      };
      touch(session);
      ws.addEventListener("open", (() => {
        /*
         * The provider's spelling (their realtime contract): first message
         * is the JSON config, then binary audio, then an empty string to
         * end. audio_format "auto" lets the browser send what
         * MediaRecorder produces (webm/opus) without a PCM pipeline.
         *
         * "pcm16k" (the voice loop, 2026-08-22 rebuild): raw s16le mono
         * 16 kHz frames. Raw PCM has NO container header, which is the
         * property the always-on wake listener needs — it can gate chunks
         * on local VAD (streaming only actual speech, with a pre-roll ring)
         * without ever corrupting a container mid-stream.
         */
        ws.send(JSON.stringify({
          api_key: apiKey,
          model,
          ...(format === "pcm16k"
            ? { audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 }
            : {
                audio_format: "auto",
                /*
                 * Speakers, on the RECORDING lane only (2026-08-26). The
                 * wake-word lane (pcm16k) listens for one person saying one
                 * name — diarizing it would buy nothing and cost provider
                 * work on every silent minute of the day.
                 *
                 * Proven before it shipped, against the real endpoint with
                 * the multi-voice fixture (scripts/live-stt-probe.mjs):
                 * captions still stream AND labels arrive (3 distinct on
                 * that clip). That run is why this is a plain flag and not
                 * a fallback ladder — the risk it would have hedged was
                 * measured to be absent, and a ladder nobody can trigger is
                 * untested code guarding a state that does not occur.
                 */
                enable_speaker_diarization: true,
              }),
          language_hints: ["fa", "en"],
          /*
           * STRICT (2026-08-29, the Korean incident): hints alone only
           * PREFER fa/en — on a mumbled wake, Soniox's language ID was
           * free to answer in Korean, and everything downstream honored
           * the garbage faithfully (the reply rule mirrored it back).
           * `language_hints_strict` is the provider's own restriction:
           * transcribe in the hinted languages only.
           */
          language_hints_strict: true,
          enable_language_identification: true,
          /*
           * The same structured context the async lane sends (C1): names
           * and jargon the live captions should spell right the first time.
           * Only when there is one — an empty context is a claim we did not
           * make.
           */
          ...(context && (context.terms.length > 0 || context.text || context.general?.length)
            ? { context: {
                ...(context.terms.length > 0 ? { terms: context.terms } : {}),
                ...(context.text ? { text: context.text } : {}),
                ...(context.general?.length ? { general: context.general } : {}),
              } }
            : {}),
        }));
      }) as never);
      ws.addEventListener("message", ((event: { data: unknown }) => {
        try {
          const body = JSON.parse(String(event.data)) as {
            tokens?: { text?: string; is_final?: boolean; speaker?: number | string; language?: string }[];
            error_code?: number | string;
          };
          if (body.error_code !== undefined) {
            // code only — the message could quote audio content
            push(session, { type: "error", code: String(body.error_code) });
            reap(session, "provider_error", String(body.error_code));
            return;
          }
          if (Array.isArray(body.tokens) && body.tokens.length > 0) {
            push(session, {
              type: "tokens",
              tokens: body.tokens.map((token) => ({
                text: String(token.text ?? ""),
                is_final: token.is_final === true,
                /* absent stays ABSENT — a defaulted "1" would be this
                   layer inventing a speaker nobody detected */
                ...(token.speaker === undefined || token.speaker === null
                  ? {}
                  : { speaker: String(token.speaker) }),
                ...(typeof token.language === "string" && token.language !== ""
                  ? { language: token.language }
                  : {}),
              })),
            });
          }
        } catch { /* a non-JSON frame — nothing to surface */ }
      }) as never);
      ws.addEventListener("close", (() => {
        reap(session, session.stopping ? "stopped" : "provider_closed");
      }) as never);
      ws.addEventListener("error", (() => {
        push(session, { type: "error", code: "provider_socket" });
        reap(session, "provider_socket");
      }) as never);
      sessions.set(session.id, session);
      return { session_id: session.id, ticket: session.ticket };
    },

    /** binary audio straight through; false = no such session (one answer) */
    pushAudio(id: string, userId: string, bytes: Uint8Array): boolean {
      return doPush(owned(id, userId), bytes);
    },
    /** the browser's DIRECT lane — the ticket is the whole authority */
    pushAudioByTicket(id: string, ticket: string, bytes: Uint8Array): boolean {
      return doPush(byTicket(id, ticket), bytes);
    },

    /** attach ONE reader; queued events drain first. Returns detach. */
    subscribe(id: string, userId: string, reader: (event: LiveEvent) => void): (() => void) | null {
      return doSubscribe(owned(id, userId), reader);
    },
    subscribeByTicket(id: string, ticket: string, reader: (event: LiveEvent) => void): (() => void) | null {
      return doSubscribe(byTicket(id, ticket), reader);
    },

    stop(id: string, userId: string): boolean {
      const session = owned(id, userId);
      if (!session) return false;
      session.stopping = true;
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
