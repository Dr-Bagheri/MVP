import { AuthError, changePassword, verifyRecoveryToken } from "@/server/supabase";

/**
 * Consume a recovery link and set the new password — the half that did not
 * exist, and whose absence left tonight's user with no way back into their own
 * account.
 *
 * Three steps, server-side, in one request:
 *   1. `POST /verify {type:"recovery", token_hash}` turns the emailed token
 *      into a session **here**, never in the browser (M1);
 *   2. `PUT /user {password}` sets the new password with it;
 *   3. an INVITED arrival is registered with that token (db/0060's by-email
 *      door), and then the tokens are DROPPED — no cookie. The person signs
 *      in with the password they just set (user ruling, 2026-08-20; see the
 *      comment at the bottom for why the convenience sign-in was the bug).
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
   * NO session cookie is written — deliberately, by user ruling (2026-08-20:
   * "it must not go in without a session and login"). The first version
   * signed the person in here "rather than bouncing them to a login form",
   * and that convenience MASKED the one failure that matters: a password
   * that never actually took still let them straight into the platform, and
   * they discovered it only days later at their next sign-in. Ending at the
   * sign-in form makes every completed reset immediately EXERCISE the new
   * password — the flow now proves itself every time it runs.
   *
   * The INVITED arrival still registers here, server-side with the verified
   * token (never a cookie): db/0060's by-email door redeems their invitation
   * so that when they sign in seconds later they are already a member —
   * without this, the org-choice screen would ask an invitee a question that
   * was answered when they were invited. Failures are swallowed: the same
   * door catches them at first sign-in (core's design), so the fallback is
   * the same behavior, later.
   */
  if (verifyType === "invite") {
    const base = process.env.CORE_API_URL?.replace(/\/+$/, "");
    if (base) {
      try {
        await fetch(`${base}/v1/signup`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${tokens.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ display_name: "" }),
        });
      } catch {
        /* the by-email door catches them at first sign-in */
      }
    }
  }

  return Response.json({ ok: true });
}
