import { cookies } from "next/headers";
import { exchangeOAuthCode } from "@/server/supabase";
import { writeSession } from "@/server/session";

/**
 * The OAuth return address. The provider round-trip lands here with an
 * opaque `?code=`; together with the PKCE verifier from the httpOnly cookie
 * it becomes a session — exchanged server-side, stored in the session
 * cookie, never shown to the browser (M1).
 *
 * Success routes to the sign-in page with `?confirmed=1`, which — already
 * holding a session — immediately routes by identity: a first-time OAuth
 * user is `unregistered` and gets the org-choice step (register-on-first-
 * sign-in absorbs OAuth arrivals with zero extra machinery); a returning
 * one goes straight into the app.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const store = await cookies();
  const verifier = store.get("echo_pkce")?.value;
  store.delete("echo_pkce"); // one round trip per verifier, success or not

  const to = (q: string) => Response.redirect(new URL(`/en/sign-in?${q}`, url.origin), 303);

  if (!code || !verifier) return to("oauth=failed");

  try {
    const tokens = await exchangeOAuthCode(code, verifier);
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return to("confirmed=1");
  } catch {
    // expired code, replayed code, provider mismatch — all one honest answer
    return to("oauth=failed");
  }
}
