import { verifySignupToken } from "@/server/supabase";
import { writeSession } from "@/server/session";

/**
 * The landing for the CONFIRM-SIGNUP email link (M15 as amended: the
 * confirmed email IS the acceptance, so this click is the whole gate).
 *
 * The email template links here with an opaque `token_hash`; the exchange
 * happens on this side and the session lands in the httpOnly cookie — the
 * browser never sees a token (M1). Without this route, Supabase's default
 * link dumps the entire session into the URL fragment at the site root,
 * which is how the first real confirmation actually arrived.
 *
 * Success redirects to the sign-in page with `?confirmed=1`, which — already
 * holding a session — immediately routes by identity: a brand-new person
 * gets the org-choice step, a registered one goes straight in. Failure
 * (expired or already-used link) redirects with `?confirmed=failed`, where
 * the page says so instead of leaving a person staring at an unexplained
 * sign-in form.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const to = (q: string) => {
    const dest = new URL(`/en/sign-in?confirmed=${q}`, url.origin);
    return Response.redirect(dest, 303);
  };

  // Anything but the two confirmation shapes is a link we never minted.
  if (!tokenHash || (type !== "signup" && type !== "email")) return to("failed");

  try {
    const tokens = await verifySignupToken(tokenHash, type);
    await writeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return to("1");
  } catch {
    // Expired and already-used links are indistinguishable here, and both are
    // honestly answered by "the link no longer works — sign in instead":
    // a person who already confirmed CAN sign in, one who never did cannot.
    return to("failed");
  }
}
