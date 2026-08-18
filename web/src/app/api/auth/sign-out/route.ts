import { clearSession, readSession } from "@/server/session";
import { revokeSession } from "@/server/supabase";

/**
 * POST, not GET — signing out is a state change, and a GET would let any
 * page log the user out with an <img> tag.
 *
 * Sign-out is TWO deletions, and the second is the one that makes it real:
 *
 *  1. the cookie goes — this browser no longer carries a session;
 *  2. the session is REVOKED at GoTrue — the refresh token dies upstream, so
 *     the credential cannot mint new access tokens from anywhere. Without
 *     this, "signed out" meant "this browser forgot", and a captured cookie
 *     value stayed a working key for 30 days. The user's gate requirement is
 *     the stronger sentence: *the session terminated and it cannot go in
 *     anymore.*
 *
 * The revoke is best-effort by design: GoTrue being unreachable must not
 * leave someone unable to sign out of their own browser. The access token is
 * short-lived either way; what an unrevoked refresh token costs is bounded,
 * and what a refused sign-out costs is trust in the door.
 *
 * `Clear-Site-Data: "cache"` is the half a redirect cannot do: pressing Back
 * after sign-out restores the previous page from the browser's own caches
 * (bfcache included) without a single request reaching the middleware gate —
 * a signed-out person reading the signed-in screen. This header tells the
 * browser to evict this origin's cached pages, so Back has to renavigate and
 * meets the gate. Deliberately NOT `"storage"`: that would also wipe the
 * theme preference, which survives sign-out on purpose.
 */
export async function POST() {
  const session = await readSession();
  if (session) {
    try {
      await revokeSession(session.accessToken);
    } catch {
      // unreachable auth provider must not hold the door shut on the way out
    }
  }
  await clearSession();
  return Response.json(
    { ok: true },
    { headers: { "clear-site-data": '"cache"' } },
  );
}
