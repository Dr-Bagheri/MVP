import { AuthError, changePassword, signInWithPassword } from "@/server/supabase";
import { readSession, writeSession } from "@/server/session";

/**
 * Set the FIRST password on an OAuth-born account (user directive,
 * 2026-08-18: a Google/GitHub arrival names their organization AND sets a
 * password before they are in).
 *
 * Why this exists beside `/api/auth/change-password`: that route verifies the
 * CURRENT password before changing anything — the guard that stops a stolen
 * session from locking the owner out. An OAuth-born account has no current
 * password to verify; the session itself — minted seconds ago by the provider
 * round-trip — is the proof of ownership here. The two must not share a
 * route: relaxing the current-password check for one caller relaxes it for
 * every caller.
 *
 * What the password buys: email + password become a second door to the same
 * account. The person can come back through Google/GitHub OR through the
 * login form — their address in the email box, this password in its box —
 * exactly the pair the user described.
 *
 * The email comes from the session's own token, never from the body (the
 * `/v1/signup` rule again). After GoTrue accepts the password, we
 * re-authenticate WITH it and replace the cookie: password changes can revoke
 * outstanding sessions depending on project settings, and "set a password,
 * instantly signed out" reads as failure.
 */
function emailFromToken(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: string };
    return payload.email?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "no session", kind: "unauthenticated" }, { status: 401 });
  }

  const { new_password } = (await request.json()) as { new_password?: string };
  if (!new_password) {
    return Response.json({ error: "new_password is required", kind: "invalid" }, { status: 400 });
  }

  try {
    await changePassword(session.accessToken, new_password);
  } catch (error) {
    if (error instanceof AuthError) {
      // GoTrue's own sentence — length, complexity, leaked-password checks
      return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }

  /*
   * Best-effort re-authentication with the new password. A failure here is
   * NOT a failed password set — GoTrue accepted it above — so the answer
   * stays ok and the existing session keeps serving until its expiry.
   */
  const email = emailFromToken(session.accessToken);
  if (email) {
    try {
      const tokens = await signInWithPassword(email, new_password);
      await writeSession({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });
    } catch {
      // the set succeeded; the refreshed cookie is a nicety, not the outcome
    }
  }

  return Response.json({ ok: true });
}
