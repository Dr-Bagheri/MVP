import { api } from "@/api/client";
import type { AgentEvent, AgentMessage } from "@/api/types";
import { setLiveConversation } from "./liveConversation";

/**
 * ONE CONVERSATION, TWO WINDOWS ONTO IT.
 *
 * USER DIRECTIVE, 2026-09-04: "i started a chat with ai assistant in its page,
 * mid thinking of the ai i changed page and the answer was lost … the side bar
 * of ai assistant and its page is basically one, they are connected, anything
 * start in one can be continue in the other, it should be like a mirroring in
 * two different places one page and one side bar."
 *
 * ── WHY THE ANSWER WAS LOST ────────────────────────────────────────────────
 *
 * The stream lived inside the page component. Navigating away unmounted it,
 * the cleanup aborted its `AbortController`, and aborting the fetch closes the
 * SSE body — which the server reads as "nobody is listening" and stops the
 * run. So the answer was not merely hidden by the navigation: it was CANCELLED
 * by it, and the sidebar that took over had nothing to show because there was
 * no longer anything being said.
 *
 * `liveConversation` had already carried the session ID across that walk, and
 * it was the right fix for a FINISHED thread: both surfaces load the same rows
 * from the server. It cannot help mid-run, because the rows do not exist yet —
 * a half-written answer is not in the database, it is in flight.
 *
 * ── WHY A MODULE, NOT A CONTEXT ────────────────────────────────────────────
 *
 * A React context would put the state above both surfaces in the tree, which
 * is enough for the two of them to SHARE it — and not enough to keep the run
 * alive, because the effect that owns the fetch still belongs to whichever
 * component started it. The run has to outlive every component, so it lives
 * outside React entirely: a module holds the messages and the controller, the
 * surfaces subscribe through `useSyncExternalStore`, and unmounting a surface
 * unsubscribes a listener rather than cancelling a request.
 *
 * That is the "mirroring" in one sentence: **neither surface owns the
 * conversation, and both render the same one.** A question typed in the
 * sidebar and a question typed on the page enter the same array; the reply
 * streams into the same message; whichever surface is mounted is watching it.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * Skills, models, attachments, sources, workflow cards, drafts, feedback — all
 * of it stays with the composer that offers it. Those are things a person is
 * choosing on a screen, and a screen is the right place for them. What is here
 * is what has to survive the screen: the thread, the run, and which
 * conversation this is.
 *
 * PER TAB. Two windows are two people's worth of attention (`liveConversation`
 * settled this already); nothing here reaches across tabs, and nothing is
 * persisted — a hard reload starts from the stored thread, which is what the
 * server has, which is the honest answer to "what was said".
 */

/** How the run ended, for the surfaces that annotate a settled turn. */
export type SettleReason = "done" | "aborted" | "failed";

export interface AssistantSnapshot {
  /** the thread, in order — the SAME array object for both surfaces */
  messages: AgentMessage[];
  /** a run is in flight; a composer must refuse to start a second one */
  streaming: boolean;
  /** the conversation these messages belong to, once the server names it */
  sessionId: string | null;
  /**
   * A refusal that happened BEFORE the run started. Not an error banner for a
   * stream that died mid-answer — that is annotated on the turn itself, and
   * saying "the request was refused" about a run that had already started
   * answering is a false sentence.
   *
   * `detail` is the SERVER's own sentence when it gave one ("no model
   * selected…"), which is actionable where a generic refusal is not. Its
   * absence is not a blank: the surface renders its own translated line, and
   * the store does not attempt to — a module with no locale writing user copy
   * is how English lands on a Persian screen (the repo's standing refusal
   * rule: a code, and the words at the consumer).
   */
  error: { detail?: string } | null;
}

/**
 * What a mounted surface can DO on behalf of a run — navigation, locale, the
 * consent card. A run outlives its surface, so this is registered by whichever
 * one is mounted rather than captured when the run starts.
 *
 * Latest registration wins. Two surfaces are never both mounted in practice
 * (the sidebar hides itself on the assistant page), but the rule has to be
 * stated: a client tool executed twice would navigate twice.
 */
export interface SurfaceAdapter {
  handleClientTool: (event: Extract<AgentEvent, { type: "client_tool_call" }>) => Promise<void>;
  /** the thread was settled — refetch the persisted rows, refresh drafts */
  onSettled?: (reason: SettleReason) => void;
  /**
   * Every token, for a surface that SPEAKS the answer. The sidebar starts
   * talking at the first finished sentence rather than after the last one, so
   * it needs the stream as it arrives and not the settled message.
   *
   * A capability of the surface, exactly like navigation: the store does not
   * know what a voice is, and the component that owns the speaker does.
   */
  onDelta?: (delta: string) => void;
}

let state: AssistantSnapshot = {
  messages: [],
  streaming: false,
  sessionId: null,
  error: null,
};

const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let adapter: SurfaceAdapter | null = null;

function publish(next: Partial<AssistantSnapshot>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Reduce over the thread in place — the common shape of every event below. */
function patch(id: string, change: (m: AgentMessage) => AgentMessage): void {
  publish({ messages: state.messages.map((m) => (m.id === id ? change(m) : m)) });
}

export function assistantSnapshot(): AssistantSnapshot {
  return state;
}

/**
 * The server has no conversation, and it must be the SAME frozen object every
 * call: `useSyncExternalStore` compares snapshots by identity and throws
 * "getServerSnapshot should be cached" the moment a fresh literal is returned
 * per render. (This repo has paid for that one before, in `preferences`.)
 */
const EMPTY: AssistantSnapshot = { messages: [], streaming: false, sessionId: null, error: null };
export function assistantServerSnapshot(): AssistantSnapshot {
  return EMPTY;
}

export function subscribeAssistant(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A mounted surface offers its hands to whatever is running. */
export function registerAssistantSurface(next: SurfaceAdapter): () => void {
  adapter = next;
  return () => { if (adapter === next) adapter = null; };
}

/** Replace the thread with rows read from the server (resume, adopt, reload). */
export function adoptAssistantThread(sessionId: string | null, messages: AgentMessage[]): void {
  publish({ sessionId, messages, error: null });
  if (sessionId !== null) setLiveConversation(sessionId);
}

/** Start over. Aborts anything in flight — the person asked for a blank page. */
export function resetAssistantSession(): void {
  controller?.abort();
  controller = null;
  publish({ messages: [], sessionId: null, error: null, streaming: false });
  setLiveConversation(null);
}

export function clearAssistantError(): void {
  if (state.error !== null) publish({ error: null });
}

/** The stop button. */
export function stopAssistant(): void {
  controller?.abort();
}

/**
 * A stream that ended without `done`.
 *
 * The wire contract is explicit that `done` is always the last event, failure
 * included — so an ending without it is a transport death, never a success.
 * Both surfaces used to check this separately and one of them checked it
 * later than the other; it is one check now.
 */
export class StreamDied extends Error {
  constructor() { super("stream ended without done"); this.name = "StreamDied"; }
}

export interface AskInput {
  /** what the person actually sent, already assembled (attachments folded in) */
  question: string;
  /** the surface's own name for where the ask came from */
  page: string;
  callIds?: string[];
  /** everything the composer chose; passed to `api.ask` verbatim */
  options?: Omit<Parameters<typeof api.ask>[3], "signal">;
  /** client-only tag the hub uses to offer a download when the answer lands */
  created?: AgentMessage["created"];
}

/**
 * Ask, and keep asking after the screen changes.
 *
 * Returns when the run settles. Nothing awaits it for correctness — the store
 * is the record — but a caller that wants to do something afterwards can.
 */
export async function askAssistant(input: AskInput): Promise<void> {
  if (state.streaming) return;   // one run at a time; the composers refuse too

  const stamp = Date.now();
  const replyId = `a-${stamp}`;
  publish({
    error: null,
    streaming: true,
    messages: [
      ...state.messages,
      { id: `u-${stamp}`, role: "user", content: input.question, tool_calls: [], proposal: null },
      {
        id: replyId, role: "assistant", content: "", tool_calls: [], proposal: null,
        streaming: true,
        ...(input.created ? { created: input.created } : {}),
      },
    ],
  });

  const outcome = await runStream(replyId, (signal) =>
    api.ask(
      input.question,
      { page: input.page, callIds: input.callIds ?? [] },
      state.sessionId ?? undefined,
      { ...input.options, signal },
    ));

  /*
   * THE STALE-THREAD TRAP (user screenshot, 2026-08-22: EVERY ask died "not
   * found"). The stored conversation id can be gone — swept, purged, or minted
   * against a different database — and a dead thread must not kill every
   * future question. Drop the id, take the two doomed turns back off the
   * thread, and ask once more with a clean slate; a second failure has no
   * stored id and reports honestly.
   *
   * It lived in the sidebar, which is why the assistant PAGE never had it: the
   * id is the conversation's, not a surface's, and so is its recovery.
   */
  if (outcome === "stale-session") {
    publish({
      sessionId: null,
      error: null,
      messages: state.messages.filter((m) => m.id !== replyId && m.id !== `u-${stamp}`),
    });
    setLiveConversation(null);
    await askAssistant(input);
  }
}

/**
 * Ask again, same question, no new turn.
 *
 * A regenerate appends only the REPLY: the question is already in the thread
 * and adding a second copy of it would rewrite what the person said in order
 * to show what the model did.
 */
export async function regenerateAssistant(
  opts: { model?: string; locale?: string },
): Promise<void> {
  if (state.streaming || state.sessionId === null) return;
  const session = state.sessionId;
  const replyId = `a-${Date.now()}`;
  publish({
    error: null,
    streaming: true,
    messages: [
      ...state.messages,
      { id: replyId, role: "assistant", content: "", tool_calls: [], proposal: null, streaming: true },
    ],
  });
  const outcome = await runStream(replyId, (signal) => api.regenerate(session, { ...opts, signal }));
  if (outcome === "stale-session") {
    /*
     * No retry here, and the empty reply must not be left blinking. A
     * regenerate NEEDS a conversation, so a conversation that no longer
     * exists is the end of this action rather than a reason to start a
     * different one — the thread on screen is stale too, and the honest
     * outcome is a settled turn and an error the person can read.
     */
    publish({
      sessionId: null,
      messages: state.messages.filter((m) => m.id !== replyId),
      error: {},
    });
    setLiveConversation(null);
  }
}

/**
 * The run itself — one loop, both entry points, and the reason it can survive
 * a navigation: nothing here is closed over by a component.
 */
type Outcome = "settled" | "stale-session";

async function runStream(
  replyId: string,
  start: (signal: AbortSignal) => AsyncGenerator<AgentEvent>,
): Promise<Outcome> {
  const hadSession = state.sessionId !== null;
  controller = new AbortController();
  const progress = { sawAny: false, sawDone: false };
  try {
    await consume(start(controller.signal), replyId, progress);
    if (!progress.sawDone) throw new StreamDied();
    settle("done");
  } catch (cause) {
    const status = (cause as { status?: number }).status;
    const detail = (cause as { detail?: string }).detail;
    if (hadSession && (status === 404 || /not.?found/i.test(detail ?? ""))) {
      /* the caller retries — see askAssistant. Nothing is annotated here: a
         thread that no longer exists is not a turn that failed. */
      return "stale-session";
    }
    const err = cause as Error;
    if (err.name === "AbortError") {
      /* the stop button, or a genuine disconnect. What was said stays on
         screen; the server's own rules decide what persists, and the settle
         hook refetches exactly that. */
      patch(replyId, (m) => ({ ...m, streaming: false }));
      settle("aborted");
    } else {
      /*
       * Settle the turn the way `done` would have. A reply that said NOTHING
       * is no turn at all — it goes, and the failure moves onto the question
       * it annotates; a PARTIAL reply is a real turn that ended badly, so it
       * stays, settled and marked. Never a synthetic bubble: the thread is
       * the record and our commentary must not be able to join it.
       */
      const idx = state.messages.findIndex((m) => m.id === replyId);
      const empty = (state.messages[idx]?.content ?? "") === "";
      publish({
        messages: state.messages
          .map((m, i) => {
            if (m.id === replyId) return { ...m, streaming: false, failed: true };
            if (empty && i === idx - 1 && m.role === "user") return { ...m, failed: true };
            return m;
          })
          .filter((m) => !(m.id === replyId && empty)),
        /*
         * Only where the sentence is TRUE (distinguish the kinds of nothing).
         * A refusal or a fetch that never connected did happen before any run;
         * a stream that died mid-answer did not, and the annotation on the
         * turn is the honest sign there. `detail` is the server's own words —
         * "no model selected" is the difference between a bug report and a
         * fixed dropdown.
         */
        error:
          cause instanceof StreamDied || progress.sawAny
            ? null
            : { ...(detail === undefined ? {} : { detail }) },
      });
      settle("failed");
    }
  } finally {
    controller = null;
    publish({ streaming: false });
  }
  return "settled";
}

function settle(reason: SettleReason): void {
  adapter?.onSettled?.(reason);
}

async function consume(
  stream: AsyncGenerator<AgentEvent>,
  replyId: string,
  progress: { sawAny: boolean; sawDone: boolean },
): Promise<void> {
  for await (const event of stream) {
    progress.sawAny = true;
    switch (event.type) {
      case "session":
        /* the earliest moment a lazily created conversation has an id.
           Published to `liveConversation` too, so a surface that mounts
           after this point adopts the thread rather than starting a new one */
        publish({ sessionId: event.id });
        setLiveConversation(event.id);
        break;
      case "route":
        /*
         * WHO IS ANSWERING (M48), before a word of the answer.
         *
         * Written onto the reply that is already in the thread rather than
         * announced separately: the avatar and the name beside a streaming
         * message are the same two things a settled turn shows, so the turn
         * does not change shape when it finishes. Echo is the ABSENCE of an
         * author, which is what that column has always meant — routing to
         * Echo must leave the message exactly as it was, not stamp it with a
         * handle no roster row has.
         */
        patch(replyId, (m) => (event.agent === "echo"
          ? m
          : { ...m, author: event.agent }));
        break;
      case "text_delta":
        patch(replyId, (m) => ({ ...m, content: m.content + event.delta }));
        adapter?.onDelta?.(event.delta);
        break;
      case "client_tool_call":
        /*
         * The hands belong to whichever surface is mounted RIGHT NOW, which
         * may not be the one that asked. With no surface — the window is on a
         * route that renders neither, briefly, during a navigation — the
         * runner is not called and the server's own 120s timeout ends the
         * wait. That is a worse outcome than performing it and a better one
         * than pretending: an unanswered tool call is visible as a run that
         * stalls, where a fabricated result is not visible at all.
         */
        await adapter?.handleClientTool(event);
        break;
      case "agent_message": {
        /*
         * A COLLEAGUE SPOKE (db/0169). Inserted BEFORE Echo's streaming
         * reply: Echo is still writing into `replyId` and its conclusion
         * refers to what the colleague just said, so appending at the end
         * would read backwards. Its own message with its own `author`, never
         * merged — the reader has to be able to tell whose sentence it is.
         */
        const idx = state.messages.findIndex((m) => m.id === replyId);
        const turn: AgentMessage = {
          id: `${replyId}-${event.author}-${state.messages.length}`,
          role: "assistant",
          content: event.text,
          tool_calls: [],
          proposal: null,
          author: event.author,
          ...(event.failed ? { failed: true } : {}),
        };
        publish({
          messages: idx === -1
            ? [...state.messages, turn]
            : [...state.messages.slice(0, idx), turn, ...state.messages.slice(idx)],
        });
        break;
      }
      case "tool_call":
        patch(replyId, (m) => ({
          ...m,
          tool_calls: [
            ...m.tool_calls.filter((c) => c.id !== event.id),
            { id: event.id, name: event.name, label: event.label, state: event.state, ms: event.ms },
          ],
        }));
        break;
      /*
       * NO `proposal` CASE, deliberately. Neither surface had one: a proposal
       * reaches the screen on the persisted thread, which `onSettled` refetches
       * — so adding one here would be inventing a second path to the same card
       * while porting, which is how the two spellings start.
       */
      case "done": {
        progress.sawDone = true;
        const idx = state.messages.findIndex((m) => m.id === replyId);
        const emptyFailure = event.failed && (state.messages[idx]?.content ?? "") === "";
        publish({
          messages: state.messages
            .map((m, i) => {
              if (m.id === replyId) {
                return { ...m, streaming: false, run_id: event.runId, failed: event.failed };
              }
              if (emptyFailure && i === idx - 1 && m.role === "user") return { ...m, failed: true };
              return m;
            })
            .filter((m) => !(m.id === replyId && emptyFailure)),
        });
        break;
      }
      // no default: unknown event types are ignorable by contract
    }
  }
}

/**
 * Test seam: forget everything, including anything in flight.
 *
 * The abort is the load-bearing half. Module state that outlives a test is a
 * known hazard in this repo — `liveConversation` documents the exact symptom,
 * a previous test's late `session` event landing after the next test's
 * `beforeEach` — and a store that deliberately survives unmounting is that
 * hazard by design. Killing the stream is what stops the write from arriving.
 *
 * Listeners are NOT cleared: a component still mounted at this point would
 * lose its subscription and then silently never re-render again, which is a
 * worse failure than the one being prevented. They are notified instead, so
 * anything on screen redraws as the empty conversation it now is.
 */
export function resetAssistantForTest(): void {
  controller?.abort();
  controller = null;
  adapter = null;
  state = { messages: [], streaming: false, sessionId: null, error: null };
  for (const listener of listeners) listener();
}
