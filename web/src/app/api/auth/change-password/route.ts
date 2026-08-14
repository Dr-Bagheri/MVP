import { AuthError, changePassword, signInWithPassword } from "@/server/supabase";
import { readSession, writeSession } from "@/server/session";
import { coreFetch } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Change your own password while signed in.
 *
 * **The current password is required, and GoTrue does not require it.** A
 * valid session alone is enough for `PUT /user`, so without this check anyone
 * holding a stolen session could change the password and lock the real owner
 * out in a single request — leaving them the recovery email as their only way
 * back, which is the exact recourse tonight proved we do not have. Verifying
 * the old password first turns "I have your session" into "I also need your
 * password".
 *
 * The verification is a real sign-in against GoTrue rather than a local
 * comparison, because the password is not ours to hold and never has been.
 *
 * **The email comes from core/, not from the request body.** A body-supplied
 * address would let a caller verify SOMEONE ELSE's password against their own
 * session — the same "identity from the token, never from the body" rule that
 * `/v1/signup` follows.
 */
export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "no session", kind: "unauthenticated" }, { status: 401 });
  }

  const { current_password, new_password } = (await request.json()) as {
    current_password?: string;
    new_password?: string;
  };
  if (!current_password || !new_password) {
    return Response.json(
      { error: "current_password and new_password are required", kind: "invalid" },
      { status: 400 },
    );
  }
  if (current_password === new_password) {
    return Response.json(
      { error: "the new password must be different from the current one", kind: "invalid" },
      { status: 400 },
    );
  }

  try {
    const me = await coreFetch<User>("/v1/me");
    // re-authenticate: a 401 here means the CURRENT password is wrong, which is
    // a different failure from the new one being rejected, and the form says so
    try {
      await signInWithPassword(me.email, current_password);
    } catch (error) {
      if (error instanceof AuthError) {
        return Response.json(
          { error: "current password is incorrect", kind: "wrong_password" },
          { status: 400 },
        );
      }
      throw error;
    }

    await changePassword(session.accessToken, new_password);

    /*
     * Re-authenticate with the NEW password and replace the cookie.
     *
     * GoTrue may revoke other sessions on a password change depending on
     * project settings, and our stored access token can be among them. Without
     * this the person changes their password successfully and their very next
     * request 401s — a success message followed immediately by being thrown
     * out, which reads as the change having failed.
     */
    const tokens = await signInWithPassword(me.email, new_password);
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      // GoTrue's own words: length rules, leaked-password rejection, etc.
      return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
    }
    return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
  }
}
