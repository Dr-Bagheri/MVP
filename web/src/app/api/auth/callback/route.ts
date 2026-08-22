import { cookies } from "next/headers";
import { exchangeOAuthCode } from "@/server/supabase";
import { clearSession, writeSession } from "@/server/session";
import { CORE_URL } from "@/server/core";

/**
 * The OAuth return address. The provider round-trip lands here with an
 * opaque `?code=`; together with the PKCE verifier from the httpOnly cookie
 * it becomes a session — exchanged server-side, stored in the session
 * cookie, never shown to the browser (M1).
 *
 * Success routes to the sign-in page with `?oauth=ok` — its OWN marker,
 * deliberately distinct from the email-confirmation `?confirmed=1`. The page
 * routes by identity either way (a returning OAuth user goes straight in),
 * but a FIRST-TIME OAuth arrival needs a completion step the email path does
 * not: they name their organization AND set a password (user directive,
 * 2026-08-18 — an OAuth account with no password can only ever come back
 * through the provider, and the login form's password box would be a door
 * they can never use). The marker is how the page knows to ask.
 *
 * The redirect keeps the visitor's locale — next-intl's NEXT_LOCALE cookie
 * is set on every page visit; `/en/` hardcoded here sent Persian users to an
 * English gate mid-flow.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const store = await cookies();
  const verifier = store.get("echo_pkce")?.value;
  store.delete("echo_pkce"); // one round trip per verifier, success or not

  const locale = store.get("NEXT_LOCALE")?.value === "en" ? "en" : "fa";
  const to = (q: string) => Response.redirect(new URL(`/${locale}/sign-in?${q}`, url.origin), 303);

  if (!code || !verifier) return to("oauth=failed");

  try {
    const tokens = await exchangeOAuthCode(code, verifier);
    /*
     * THE ALLOW-LIST GATE (db/0082, user directive 2026-08-22): an OAuth
     * arrival enters only if the platform root listed their email. Asked
     * BEFORE the session is kept — "it checks and tells you if you can or
     * can not go in first". core verifies the token itself (the signup
     * posture) and answers one bit; a refusal drops the just-minted
     * session and says exactly why. If core is UNREACHABLE the arrival
     * fails closed for OAuth (unlike the sign-in page's button list,
     * which falls open — offering a button is cosmetic, admitting a
     * person is not).
     */
    try {
      const gate = await fetch(`${CORE_URL}/v1/oauth-gate`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokens.access_token}` },
        cache: "no-store",
      });
      const verdict = (await gate.json()) as { allowed?: boolean };
      if (!gate.ok || verdict.allowed !== true) {
        return to("oauth=notlisted");
      }
    } catch {
      return to("oauth=failed");
    }
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return to("oauth=ok");
  } catch {
    // expired code, replayed code, provider mismatch — all one honest answer
    await clearSession().catch(() => undefined);
    return to("oauth=failed");
  }
}
