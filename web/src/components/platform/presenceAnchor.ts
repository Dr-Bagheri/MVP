/**
 * The dock owns the assistant; the shell only offers it a visual anchor.
 * Keeping this as a tiny external store lets PresenceDock survive route/shell
 * changes without moving voice, conversation or unread state into TopBar.
 */
type AnchorListener = () => void;

let currentAnchor: HTMLElement | null = null;
const listeners = new Set<AnchorListener>();

function emitAnchorChange() {
  for (const listener of listeners) listener();
}

export function registerPresenceAnchor(anchor: HTMLElement): () => void {
  if (currentAnchor !== anchor) {
    currentAnchor = anchor;
    emitAnchorChange();
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    /* A departing shell must not clear a newer shell's anchor. This matters
       during route transitions where mount and cleanup can interleave. */
    if (currentAnchor === anchor) {
      currentAnchor = null;
      emitAnchorChange();
    }
  };
}

export function subscribePresenceAnchor(listener: AnchorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPresenceAnchorSnapshot(): HTMLElement | null {
  return currentAnchor;
}

export function getServerPresenceAnchorSnapshot(): null {
  return null;
}
