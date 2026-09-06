"use client";

/**
 * "YES, FOR THIS SESSION" (user directive, 2026-09-06: "for permissions for
 * Echo or an agent to do a job, when they ask, add the option to give
 * permission for the whole session so they don't ask one after the other").
 *
 * The consent card is what keeps «انجام شد» honest — a write the person did
 * not see is a write they cannot vouch for — and it is also, on a request
 * that files six tasks, six cards in a row. This is the person's way of
 * saying the yes once. It is deliberately SMALL:
 *
 *  · it is the BROWSER SESSION's — `sessionStorage`, so a reload keeps it and
 *    a new tab or a closed one does not; a grant that survived the night
 *    would be a setting, and a setting belongs on the dial (M36), where it is
 *    visible on a page rather than remembered by a store
 *  · it never covers a DELETE. A create or an edit is a thing the board can
 *    show and a person can undo; a delete is the one verb this platform has
 *    already lost data to (2026-09-06, the small hours), and the card for it
 *    stays. The button says so: «به‌جز حذف»
 *  · it is REVOCABLE from where it is visible — both surfaces draw a standing
 *    line while it is on, with the revoke beside it, because a grant nobody
 *    can see is a grant nobody remembers giving
 *
 * The server is not told. `requires_consent` still arrives on every write and
 * the surface answers it at once — the wall is unchanged, the person's finger
 * is what moved.
 */
const KEY = "neurai-consent-session";
const DESTROYS = /^delete_/;

let granted: boolean | null = null;
const listeners = new Set<() => void>();

function hydrate(): boolean {
  if (granted === null) {
    try {
      granted = typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "1";
    } catch {
      granted = false;
    }
  }
  return granted;
}

function set(next: boolean): void {
  granted = next;
  try {
    if (next) window.sessionStorage.setItem(KEY, "1");
    else window.sessionStorage.removeItem(KEY);
  } catch { /* this tab still honours it */ }
  for (const listener of listeners) listener();
}

/** is the standing yes on, for this browser session? */
export function consentGrantedForSession(): boolean {
  return hydrate();
}
/** for `useSyncExternalStore` on the server render */
export function consentGrantServer(): boolean {
  return false;
}
export function subscribeConsentGrant(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function grantConsentForSession(): void {
  set(true);
}
export function revokeSessionConsent(): void {
  set(false);
}
/**
 * Does the standing yes answer THIS call? Everything a person can undo, yes;
 * a delete, never — its card stays whatever was granted.
 */
export function sessionGrantCovers(tool: string): boolean {
  return hydrate() && !DESTROYS.test(tool);
}
export function resetConsentGrantForTest(): void {
  granted = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing stored */ }
  for (const listener of listeners) listener();
}
