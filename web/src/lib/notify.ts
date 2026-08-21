/**
 * The platform notification bus (user directive, 2026-08-21: "all
 * notifications pop up from the orb's head … a small talk just to alarm the
 * user").
 *
 * One module-scoped bus: anything on the platform that wants to inform the
 * person calls notify(); the PresenceDock renders the toast stack anchored
 * above the orb, and the top-bar bell keeps the recent history. No provider,
 * no context — a notice is fire-and-forget, and the two consumers must not
 * depend on mounting order.
 */

export interface PlatformNotice {
  id: string;
  text: string;
  kind: "info" | "warn";
  at: number;
}

type Listener = (notice: PlatformNotice) => void;

const listeners = new Set<Listener>();
const history: PlatformNotice[] = [];
const HISTORY_CAP = 50;

let seq = 0;

export function notify(text: string, kind: "info" | "warn" = "info"): PlatformNotice {
  const notice: PlatformNotice = { id: `n-${Date.now()}-${seq++}`, text, kind, at: Date.now() };
  history.unshift(notice);
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  for (const listener of listeners) listener(notice);
  return notice;
}

export function subscribeNotify(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** newest first; a copy — callers must not be able to edit the record */
export function notifyHistory(): PlatformNotice[] {
  return [...history];
}

/** test seam only — the bus is module state and tests share the module */
export function resetNotifications(): void {
  listeners.clear();
  history.length = 0;
}
