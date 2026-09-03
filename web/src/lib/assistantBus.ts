/**
 * One-way door into the assistant sidebar (user directive, 2026-08-21: the
 * side-docked AssistantPane leaves every page — so a surface that wants
 * "open the assistant on THIS conversation" asks the sidebar, it does not
 * render a rival).
 *
 * Same shape as the notify bus: module-scoped, fire-and-forget, no
 * mounting-order dependency. The sidebar subscribes; anyone may call.
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

/*
 * THE POST CHANNEL LEFT ON 2026-09-03 (user directive): agents no longer
 * speak inside the assistant's thread, so `AssistantAuthor`, `AssistantPost`,
 * `postToAssistant` and `subscribeAssistantPost` went with their only
 * consumer. Removed rather than kept "for when the agents land": a producer
 * with no consumer is a defect its author cannot see, and this repo has
 * shipped that at feature scale once already.
 */


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

/**
 * THE COMPOSER MAILBOX (user directive, 2026-08-26: "put the suggestions
 * on the sub menu").
 *
 * A suggestion pressed in the assistant's sub-menu has to reach the hub's
 * composer — and the press usually happens on ANOTHER page, so the hub is
 * not mounted yet to hear it. A plain fire-and-forget event would be
 * delivered to nobody and the suggestion would silently do nothing.
 *
 * So this channel keeps ONE pending draft: subscribers get it live when
 * they are already mounted, and a page that arrives afterwards takes it
 * from the mailbox. Taking it clears it — a draft is consumed once, or the
 * next visit to the page would refill the composer out of nowhere.
 */
export interface ComposerDraft {
  text: string;
  /** the skill the suggestion belongs to, selected with it */
  skillSlug?: string;
}

type ComposerListener = (draft: ComposerDraft) => void;
const composerListeners = new Set<ComposerListener>();
let pendingDraft: ComposerDraft | null = null;

export function fillComposer(draft: ComposerDraft): void {
  pendingDraft = draft;
  for (const listener of composerListeners) listener(draft);
}

/** consume the waiting draft, if any — clears it on the way out */
export function takePendingDraft(): ComposerDraft | null {
  const draft = pendingDraft;
  pendingDraft = null;
  return draft;
}

export function subscribeComposer(listener: ComposerListener): () => void {
  composerListeners.add(listener);
  return () => composerListeners.delete(listener);
}
