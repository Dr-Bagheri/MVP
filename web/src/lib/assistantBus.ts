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
