/**
 * 0184 — delivery for the team channel.
 *
 * ── THE STREAM IS A HINT; THE DATABASE IS THE RECORD ──────────────────────
 *
 * Every connect AND reconnect runs a catch-up query on `seq`, so a dropped
 * event costs nothing: the next connection asks for everything after the
 * cursor the client already holds. That single decision makes the
 * delivery-guarantee argument moot for every transport, which is why the
 * transport below is the simplest thing that works rather than the most
 * reliable thing available.
 *
 * ── WHY AN IN-PROCESS EMITTER AND NOT LISTEN/NOTIFY ───────────────────────
 *
 * One api process on one VM. LISTEN/NOTIFY earns its place the day there are
 * two — and it brings a held connection, an 8000-byte payload limit, and a
 * queue that a stuck listener can fill until every NOTIFY in the database
 * fails at commit. Adding it later is a small change.
 *
 * (Checked rather than assumed, because the answer decides whether it is even
 * available: the server's DATABASE_URLs are on port 5432, session mode.
 * PgBouncer-class poolers offer NOTIFY in transaction mode and NOT LISTEN, so
 * the write half would work and the read half would silently return nothing —
 * a healthy sender and a receiver that gets nothing.)
 *
 * ── THE FIVE THINGS THAT KILL AN SSE STREAM, AND WHAT IS DONE ABOUT THEM ──
 *
 * 1. Cloudflare's proxy READ timeout is 125s between successive reads — not a
 *    duration cap. A 15s heartbeat is under it, under the 400s idle limit, and
 *    under Cloudflare's own 30s TCP keep-alive (a 30s heartbeat races an
 *    infrastructure timer). The assistant stream survives without one only
 *    because it emits tokens continuously; a chat stream is idle by nature.
 * 2. `Content-Length` must never be set and `Content-Type` must be
 *    `text/event-stream` — that pair is what makes `cloudflared` flush
 *    instead of buffer. `X-Accel-Buffering: no` is NOT honoured by Cloudflare
 *    and is set only for any other proxy in the path.
 * 3. `Connection: keep-alive` is dropped. It is meaningless on HTTP/1.1
 *    (persistent by default) and throws ERR_HTTP2_INVALID_CONNECTION_HEADERS
 *    under HTTP/2 — a latent break the day anything upstream negotiates h2.
 * 4. Cleanup hangs off `reply.raw`, never `request.raw`. On a GET they fire
 *    together; on a POST the request's `close` fires when the BODY finished,
 *    which tears the subscription down milliseconds after it opened. This
 *    route is a GET today and the trap costs nothing to avoid.
 * 5. `app.close()` never resolves while a stream is open (Fastify's
 *    `forceCloseConnections` default is `'idle'`, and a live SSE stream is
 *    neither idle nor mid-request). Hence `closeAll()` — the shutdown path
 *    ends the streams first, or every deploy waits out systemd's stop timeout
 *    and then SIGKILLs.
 */
import { EventEmitter } from "node:events";
import type { ChatMessageRecord } from "./chat.ts";

/** what a subscriber receives. `event:` carries the type so one stream can
    serve every channel and the client demultiplexes. */
export type ChatEvent =
  | { type: "message"; message: ChatMessageRecord }
  | { type: "edited"; message: ChatMessageRecord }
  /** an agent is composing — TRANSIENT and never persisted, because a
      "thinking…" row in the record would be indistinguishable a week later
      from something the agent said */
  | { type: "agent_typing"; channel_id: string; handle: string }
  /** the agent's turn ended with nothing. Also transient: the honest record
      is the question standing unanswered, not a bubble apologising. */
  | { type: "agent_failed"; channel_id: string; handle: string };

export interface ChatSink {
  write: (chunk: string) => void;
  end: () => void;
}

const HEARTBEAT_MS = 15_000;
/** 3000ms in Chromium and 5000ms in Firefox, both FIXED with no jitter — so
    every client dropped by a deploy reconnects in one tight cluster. The
    server's own `retry:` is the only place a spread can be introduced. */
const RETRY_MIN_MS = 3000;
const RETRY_SPREAD_MS = 4000;

export function createChatBus() {
  const bus = new EventEmitter();
  /* one listener per open stream, and the default ceiling is 10 — at tens of
     users the warning fires immediately and reads exactly like a leak */
  bus.setMaxListeners(0);

  /** every open stream, so shutdown can end them before app.close() */
  const open = new Set<() => void>();

  function publish(orgId: string, event: ChatEvent): void {
    bus.emit(orgId, event);
  }

  /**
   * Attach one subscriber. Returns the detach function; the caller wires it
   * to the RESPONSE's close.
   */
  function subscribe(orgId: string, onEvent: (event: ChatEvent) => void): () => void {
    const listener = (event: ChatEvent) => onEvent(event);
    bus.on(orgId, listener);
    return () => bus.off(orgId, listener);
  }

  /**
   * Open an SSE response for one reader.
   *
   * `random` is injected so the retry spread is testable — a test that has to
   * accept any number in a range cannot tell a spread from a constant.
   */
  function open_(
    orgId: string,
    sink: ChatSink,
    options: { random?: () => number } = {},
  ): () => void {
    const rand = options.random ?? Math.random;
    sink.write(`retry: ${RETRY_MIN_MS + Math.floor(rand() * RETRY_SPREAD_MS)}\n\n`);

    const detach = subscribe(orgId, (event) => {
      sink.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const beat = setInterval(() => sink.write(": ping\n\n"), HEARTBEAT_MS);
    /* unref so an open stream cannot by itself hold the process alive — the
       socket already does that, and a timer that does it too turns a clean
       exit into a hang for a reason nobody would look for */
    beat.unref?.();

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      detach();
      open.delete(close);
      try { sink.end(); } catch { /* the socket is already gone */ }
    };
    open.add(close);
    return close;
  }

  /** end every open stream. Called BEFORE app.close(), see the header. */
  function closeAll(): void {
    for (const close of [...open]) close();
  }

  return { publish, subscribe, open: open_, closeAll, get openCount() { return open.size; } };
}

export type ChatBus = ReturnType<typeof createChatBus>;

/**
 * The capability that lets a browser talk to core DIRECTLY.
 *
 * `EventSource` cannot set an Authorization header, and the BFF hop is not an
 * option here for a harder reason than latency: every Vercel function is
 * capped at 300 seconds, which is the maximum on every plan. A chat stream
 * proxied through it would die every five minutes, forever. So the browser
 * opens the stream against core with a ticket in the query string — the same
 * shape the live transcription lane already uses, for the same reason.
 *
 * A ticket is a bearer capability, so it is short-lived, single-purpose (it
 * buys one thing: reading this org's chat events) and unguessable.
 */
export function createTicketBook(options: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const book = new Map<string, { userId: string; orgId: string; expires: number }>();

  function mint(userId: string, orgId: string, token: string): string {
    book.set(token, { userId, orgId, expires: now() + ttl });
    return token;
  }

  /**
   * Spend a ticket. Single-use: the stream holds the connection afterwards,
   * so a ticket that stayed valid would be a replayable capability sitting in
   * a URL — which is the one place a credential is most likely to be logged.
   */
  function redeem(token: string): { userId: string; orgId: string } | null {
    const entry = book.get(token);
    if (entry === undefined) return null;
    book.delete(token);
    if (entry.expires <= now()) return null;
    return { userId: entry.userId, orgId: entry.orgId };
  }

  /** drop what nobody spent, so a long-running process does not accumulate */
  function sweep(): void {
    const t = now();
    for (const [token, entry] of book) if (entry.expires <= t) book.delete(token);
  }

  return { mint, redeem, sweep, get size() { return book.size; } };
}

export type TicketBook = ReturnType<typeof createTicketBook>;
