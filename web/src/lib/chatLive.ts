"use client";

import type { ChatEvent } from "@/api/types";
import { api } from "@/api/client";

/**
 * 0184 — the browser's half of chat delivery.
 *
 * THE STREAM IS A HINT; THE DATABASE IS THE RECORD. Every connect and every
 * reconnect runs a catch-up read past the cursor the client already holds, so
 * a dropped event costs nothing and the transport is allowed to be simple.
 * Everything below is written around that one decision.
 *
 * WHY IT DOES NOT GO THROUGH OUR OWN /api ROUTE. Every Vercel function is
 * capped at 300 seconds — the maximum on every plan, not a setting — so a
 * proxied chat stream would die every five minutes, forever, and reconnect
 * into a loop that looks like flaky wifi. The browser opens this one against
 * core directly with a single-use ticket, which is also why `EventSource` can
 * be used at all: it cannot carry an Authorization header.
 *
 * AND WHEN THERE IS NO DIRECT ADDRESS, THIS FALLS BACK TO POLLING rather than
 * guessing a URL. That is the honest branch: a stream opened at a guess fails
 * silently and the room simply stops updating, which is indistinguishable
 * from nobody talking.
 */

export type ChatLiveState = "connecting" | "live" | "polling" | "off";

export interface ChatLiveHandlers {
  onEvent: (event: ChatEvent) => void;
  /** the poll lane's tick — the caller re-reads with its own cursors */
  onPoll: () => void;
  onState: (state: ChatLiveState) => void;
}

const POLL_MS = 4000;
const EVENT_TYPES = ["message", "edited", "agent_typing", "agent_failed"] as const;

/**
 * Open delivery. Returns the stop function; the caller wires it to unmount.
 *
 * `deps` exists so the test can drive both lanes without a network: an
 * EventSource that never opens is indistinguishable from one that opened and
 * received nothing, and only an injected constructor can tell them apart.
 */
export function openChatLive(
  handlers: ChatLiveHandlers,
  deps: {
    ticket?: () => Promise<{ direct_url: string | null }>;
    source?: (url: string) => EventSource;
    setTimer?: (fn: () => void, ms: number) => number;
    clearTimer?: (id: number) => void;
  } = {},
): () => void {
  const getTicket = deps.ticket ?? (() => api.chatTicket());
  const makeSource = deps.source ?? ((url: string) => new EventSource(url));
  const setTimer = deps.setTimer ?? ((fn, ms) => window.setInterval(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => window.clearInterval(id));

  let stopped = false;
  let source: EventSource | null = null;
  let poller: number | null = null;

  const startPolling = () => {
    if (stopped || poller !== null) return;
    handlers.onState("polling");
    poller = setTimer(() => handlers.onPoll(), POLL_MS);
  };

  handlers.onState("connecting");
  void getTicket()
    .then(({ direct_url }) => {
      if (stopped) return;
      if (direct_url === null) {
        /* core does not know its own public address. Polling is slower and
           it WORKS, which a stream at a guessed URL would not. */
        startPolling();
        return;
      }
      const es = makeSource(direct_url);
      source = es;
      es.onopen = () => { if (!stopped) handlers.onState("live"); };
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (event) => {
          try {
            handlers.onEvent(JSON.parse((event as MessageEvent).data) as ChatEvent);
          } catch {
            /* a malformed frame is not a reason to tear down a working
               stream — the catch-up read will carry whatever was in it */
          }
        });
      }
      es.onerror = () => {
        /* EventSource retries on its own, at the interval the server's
           `retry:` set. What it does NOT do is retry after a non-200: the
           spec fails the connection permanently. So the poll lane starts
           here as the floor, and the catch-up read on the next open makes a
           double-delivery harmless. */
        if (!stopped) startPolling();
      };
    })
    .catch(() => { if (!stopped) startPolling(); });

  return () => {
    stopped = true;
    handlers.onState("off");
    source?.close();
    if (poller !== null) clearTimer(poller);
  };
}

/**
 * Merge an arriving message into a list held oldest-first.
 *
 * BY `seq`, and idempotent: the same message can arrive twice — once on the
 * stream and once in a catch-up read that overlapped it — and a list that
 * appended blindly would show it twice. Splitting this out of the component
 * is deliberate: it is the piece with a right answer, and a test that had to
 * drive it through the DOM would be the kind of instrument that files bugs
 * against working code.
 */
export function mergeBySeq<T extends { id: string; seq: number }>(list: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return list;
  const bySeq = new Map(list.map((m) => [m.seq, m]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
