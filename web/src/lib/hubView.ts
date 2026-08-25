"use client";

/**
 * The hub's VIEW — chat (the composer-first screen) or dashboard (the
 * hybrid strip). A tiny external store because two components own halves
 * of it: the AssistantMenu highlights and switches it, the Hub renders it,
 * and neither should re-mount the other (the anchorStore pattern).
 */
export type HubView = "chat" | "dashboard";

let view: HubView = "chat";
const listeners = new Set<() => void>();

export function getHubView(): HubView {
  return view;
}

export function getServerHubView(): HubView {
  return "chat";
}

export function setHubView(next: HubView): void {
  if (view === next) return;
  view = next;
  for (const listener of listeners) listener();
}

export function subscribeHubView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
