/**
 * One-way door into the presence dock (user directive, 2026-08-21: the
 * side-docked AssistantPane leaves every page — so a surface that wants
 * "open the assistant on THIS conversation" asks the dock, it does not
 * render a rival).
 *
 * Same shape as the notify bus: module-scoped, fire-and-forget, no
 * mounting-order dependency. The dock subscribes; anyone may call.
 */

export interface AssistantOpenRequest {
  /** adopt and load this stored conversation; omitted = just open */
  sessionId?: string;
  /** pre-fill the composer (record page's "ask about this record") — a
      DRAFT the person sends or edits; never auto-submitted */
  draft?: string;
}

type Listener = (request: AssistantOpenRequest) => void;

const listeners = new Set<Listener>();

export function openAssistant(request: AssistantOpenRequest = {}): void {
  for (const listener of listeners) listener(request);
}

export function subscribeAssistantOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The recorder tells the assistant when a take is LIVE (user rule,
 * 2026-08-21: "the moment record starts it must stop listening and the
 * orb get close" — both were transcribing the same room, so everything
 * arrived twice: once in the call, once as commands). true = recording
 * rolling; false = paused/finished, ears may come back.
 */
type RecordingListener = (live: boolean) => void;
const recordingListeners = new Set<RecordingListener>();

export function announceRecordingLive(live: boolean): void {
  for (const listener of recordingListeners) listener(live);
}

export function subscribeRecordingLive(listener: RecordingListener): () => void {
  recordingListeners.add(listener);
  return () => recordingListeners.delete(listener);
}
