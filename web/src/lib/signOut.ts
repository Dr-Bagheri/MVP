/**
 * The ONE sign-out flow — extracted from AvatarMenu (2026-08-28) the day
 * the sessions table's "this device" row needed to offer it too. Two
 * copies of a flow that sweeps storage and tears the document down is two
 * flows that drift; the avatar menu and the sessions table now consume
 * the same one.
 */
export async function signOutThisDevice(locale: string): Promise<void> {
  // FE1's route, consumed not forked: POST because signing out is a state
  // change and a GET would let any page log the user out with an <img>
  await fetch("/api/auth/sign-out", { method: "POST" });
  /*
   * Conversation drafts are keyed by conversation, not by person — the
   * server's Clear-Site-Data deliberately spares "storage" to keep the
   * theme, so a half-typed question would otherwise survive into the NEXT
   * account signed in from this tab (2026-08-20 tenancy audit). Sweep
   * exactly the draft keys; the theme stays untouched.
   */
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("neurai-draft-")) sessionStorage.removeItem(key);
    }
    // the presence dock's continuous thread must not follow the NEXT
    // account on a shared machine (M34) — same reasoning as the drafts
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("neurai-presence-session")) localStorage.removeItem(key);
    }
  } catch {
    // storage can be unavailable (privacy mode); sign-out proceeds anyway.
  }
  /*
   * A HARD navigation, not router.replace: the app router's client cache
   * still holds the signed-in screens' payloads, and a soft navigation
   * would leave them restorable through Back without any request hitting
   * the middleware gate. Tearing the document down is the sign-out.
   */
  window.location.assign(`/${locale}/sign-in`);
}
