import { AuthError, changePassword, verifyRecoveryToken } from "@/server/supabase";
import { writeSession } from "@/server/session";

/**
 * Consume a recovery link and set the new password — the half that did not
 * exist, and whose absence left tonight's user with no way back into their own
 * account.
 *
 * Three steps, server-side, in one request:
 *   1. `POST /verify {type:"recovery", token_hash}` turns the emailed token
 *      into a session **here**, never in the browser (M1);
 *   2. `PUT /user {password}` sets the new password with it;
 *   3. the session is written to the httpOnly cookie, so the person is signed
 *      in on success rather than being bounced to a login form seconds after
 *      proving they own the address.
 *
 * **The token is single-use and short-lived**, which is why the three steps
 * are one route: consuming it in one request and asking for the password in
 * another would burn the token on a page that might never be submitted, and
 * the person would have to request a second email to finish.
 *
 * A failure at step 1 is `invalid_token` and it is not the caller's fault in
 * any way they can fix by retrying — expired, already used, or altered. The
 * page says so and offers a fresh email, rather than a retry that cannot work.
 */
export async function POST(request: Request) {
  const { token_hash, new_password, type } = (await request.json()) as {
    token_hash?: string;
    new_password?: string;
    type?: string;
  };
  if (!token_hash || !new_password) {
    return Response.json(
      { error: "token_hash and new_password are required", kind: "invalid" },
      { status: 400 },
    );
  }
  // allow-listed: an INVITE link proves the address the same way a recovery
  // link does, and sets the first password instead of a new one. Anything
  // else verifies as recovery — never a caller-chosen free string.
  const verifyType = type === "invite" ? "invite" : "recovery";

  let tokens;
  try {
    tokens = await verifyRecoveryToken(token_hash, verifyType);
  } catch (error) {
    /*
     * Deliberately its own kind. Folding it into `invalid` would put "this
     * link has expired" next to "that password is too short" in the caller's
     * error handling, and the two need different screens: one needs a new
     * email, the other needs a different password.
     */
    const message = error instanceof AuthError ? error.message : "recovery link rejected";
    return Response.json({ error: message, kind: "invalid_token" }, { status: 400 });
  }

  try {
    await changePassword(tokens.access_token, new_password);
  } catch (error) {
    if (error instanceof AuthError) {
      // GoTrue's own sentence — length, complexity, leaked-password checks
      return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }

  /*
   * Written only AFTER the password change succeeds. Signing them in on a
   * verified-but-unchanged token would leave someone holding a session they
   * reached with a link they may not have requested, having proved nothing
   * they intended.
   */
  await writeSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  return Response.json({ ok: true });
}
