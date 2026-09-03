/**
 * One-way door into the assistant sidebar (user directive, 2026-08-21: the
 * side-docked AssistantPane leaves every page — so a surface that wants
 * "open the assistant on THIS conversation" asks the sidebar, it does not
 * render a rival).
 *
 * Same shape as the notify bus: module-scoped, fire-and-forget, no
 * mounting-order dependency. The sidebar subscribes; anyone may call.
 */
import type { IconName } from "@/components/icons";

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
 * THE SIDEBAR IS A ROOM, NOT A TEXT BOX (user directive, 2026-09-03: "agents
 * post into it — when an agent drafts a reply or preps a meeting, that appears
 * in the sidebar as a message from that agent").
 *
 * The agents themselves (Roya, who acts; Ava, who reads and reports) land in a
 * later change. What this channel is for is the half that cannot be added
 * later without touching every render site: a message in that thread may come
 * from somebody other than "the assistant", and it has to say who.
 *
 * Deliberately its own channel rather than a second meaning for
 * `openAssistant`: a post must be able to arrive while the sidebar is
 * COLLAPSED and become an unread count, and a channel whose only verb is
 * "open" cannot express that.
 */
export interface AssistantAuthor {
  /** the agent's own name, already in the reader's language */
  name: string;
  /** their face — a glyph from the platform's one icon registry, never an
      emoji and never a second drawing (the agentAppearance rule) */
  icon?: IconName;
}

export interface AssistantPost {
  content: string;
  /** omitted = the assistant itself, which is what every message was until
      now — an absent author is a real value here, not a missing one */
  author?: AssistantAuthor;
}

type PostListener = (post: AssistantPost) => void;
const postListeners = new Set<PostListener>();

export function postToAssistant(post: AssistantPost): void {
  for (const listener of postListeners) listener(post);
}

export function subscribeAssistantPost(listener: PostListener): () => void {
  postListeners.add(listener);
  return () => postListeners.delete(listener);
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
