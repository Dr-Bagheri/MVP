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
 *  · it never covers a DELETE — the one verb this platform has already lost
 *    data to (2026-09-06, the small hours) — nor, since the same afternoon's
 *    ruling, any write whose effect leaves the person's own screen: see
 *    NEVER_COVERED. The card offers the button only for a call the yes would
 *    cover, so a person is never offered a standing yes that would not stand
 *  · it is REVOCABLE from where it is visible — both surfaces draw a standing
 *    line while it is on, with the revoke beside it, because a grant nobody
 *    can see is a grant nobody remembers giving
 *
 * The server is not told. `requires_consent` still arrives on every write and
 * the surface answers it at once — the wall is unchanged, the person's finger
 * is what moved.
 */
const KEY = "neurai-consent-session";

/**
 * WHAT THE STANDING YES NEVER COVERS (user ruling, 2026-09-06 afternoon: "yes,
 * exclude them"). Each class is a verb whose effect leaves the person's own
 * screen or cannot be taken back: a message somebody else reads, an
 * invitation that lands in a mailbox, a role or a permission that changes
 * what a colleague can do, a record's scope, minutes approved on the org's
 * behalf, a conversation shared, a grant revoked, the model list — and a
 * delete. A yes given once for "the rest of this session" cannot be an
 * informed yes to any of these, because each is a different sentence every
 * time. `set_member_role` rides with `set_member_status` on the ruling's own
 * words ("role and permission changes"): making somebody an admin is the
 * larger of the two.
 */
const NEVER_COVERED: readonly RegExp[] = [
  /^delete_/,
  /^send_/,
  /^invite_/,
  /^revoke_/,
  /^set_role_permission$/,
  /^set_member_status$/,
  /^set_member_role$/,
  /^set_record_scope$/,
  /^approve_minutes$/,
  /^share_conversation$/,
  /^set_model_allowed$/,
  /* an MCP tool's effect is whatever the remote server decides — the one
     hand whose consequence nobody on this side can name in advance, so it is
     asked about every time (2026-09-06, with the connectors) */
  /^call_mcp_tool$/,
];

/**
 * May a standing yes ever answer this tool? The CARD reads this to decide
 * whether to offer «برای این نشست» at all: offering it on a card the grant
 * would not cover collects a yes that does nothing, which is worse than no
 * button.
 */
export function sessionGrantEligible(tool: string): boolean {
  return !NEVER_COVERED.some((re) => re.test(tool));
}

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
 * Does the standing yes answer THIS call? Only when it is on AND the tool is
 * one the yes may cover — a delete, a message, an invitation, a role, a
 * scope, an approval, a share, a revoke or the model list asks every time,
 * whatever was granted.
 */
export function sessionGrantCovers(tool: string): boolean {
  return hydrate() && sessionGrantEligible(tool);
}
export function resetConsentGrantForTest(): void {
  granted = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing stored */ }
  for (const listener of listeners) listener();
}
