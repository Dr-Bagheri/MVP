/**
 * WHICH CONVERSATION THE ASSISTANT IS CURRENTLY IN.
 *
 * USER DIRECTIVE, 2026-09-03: "if i asked something from the assistant and it
 * needs to navigate to another page the conversation must be continue in the
 * side bar ... and if we go to the assistant page it will be continue there."
 *
 * The first half was already true and it is worth writing down why, because it
 * decided how small this file is. The sidebar lives in `PlatformShell`, which
 * every route renders at the same position in the tree, so React reconciles it
 * across a client-side navigation instead of remounting it — measured, not
 * assumed: a draft typed into the composer on /meetings was still in the box
 * after clicking through to /tasks. Nothing had to be stored for that.
 *
 * What was NOT true is the handoff. The sidebar and the assistant PAGE are two
 * components with two conversations, so walking from one to the other started
 * over — the thing you had just been discussing was still on the server, still
 * yours, and nothing on the new screen pointed at it.
 *
 * So this holds one id, not a conversation. Both surfaces already know how to
 * load a thread from an id (`adoptThread` on the page, the resume path in the
 * sidebar); what neither had was a way to say "this is the one". Storing the
 * MESSAGES here instead would mean two renderers over one array with two
 * different message shapes, and a second copy of a thread the server already
 * holds — the two-spellings problem, at the size of a whole conversation.
 *
 * Per TAB, not per device: two windows open on the platform are two people's
 * worth of attention, and carrying a session between them would drag one
 * window's conversation into the other on every navigation. `sessionStorage`
 * rather than a bare variable so a full page load — a hard refresh, following
 * a link from outside — keeps the thread rather than silently dropping it.
 */

const KEY = "neurai-live-conversation";

let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

/** The session both surfaces should be showing, or null for "a fresh one". */
export function liveConversation(): string | null {
  if (!hydrated && typeof window !== "undefined") {
    try {
      current = sessionStorage.getItem(KEY);
    } catch {
      /* storage can throw outright under some privacy settings. The cost is a
         handoff that does not happen, which looks like starting a new
         conversation — the behaviour before this file existed. */
      current = null;
    }
    hydrated = true;
  }
  return current;
}

/** Null clears it: a new conversation is an ABSENCE, not a special value. */
export function setLiveConversation(id: string | null): void {
  if (id === current && hydrated) return;   // a no-op must not wake anybody
  current = id;
  hydrated = true;
  try {
    if (id === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, id);
  } catch { /* the handoff is in-memory only for this tab */ }
  for (const listener of listeners) listener();
}

export function subscribeLiveConversation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Test seam: forget the handoff entirely — memory AND storage.
 *
 * The first version cleared only the variable, which is a reset that is not
 * one: the next read went back to `sessionStorage` and resurrected the id.
 * It showed up as one suite's conversation continuing into the next suite's
 * first question — `expected 'sess-live-1' to be undefined` on an ask that
 * had not happened yet, which is the honest symptom of a page genuinely
 * continuing a conversation nobody in that test had started.
 *
 * A function whose name promises a reset must not leave the durable half
 * standing; the caller cannot see which half it got.
 */
export function resetLiveConversationForTest(): void {
  hydrated = false;
  current = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing stored anyway */ }
}
