import { cookies } from "next/headers";
import { exchangeOAuthCode } from "@/server/supabase";
import { writeSession } from "@/server/session";

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
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return to("oauth=ok");
  } catch {
    // expired code, replayed code, provider mismatch — all one honest answer
    return to("oauth=failed");
  }
}
