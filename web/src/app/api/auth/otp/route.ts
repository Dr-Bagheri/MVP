import { cookies } from "next/headers";
import { AuthError, requestEmailCode } from "@/server/supabase";
import { errorResponse, readJson } from "@/server/core";

/**
 * "Send me a code" — the whole of M54's gate is this one request.
 *
 * One email field, one press: GoTrue mails a link that lands on
 * `/api/auth/confirm` (token hash, exchanged on this side — M1) and prints a
 * six-digit code the same screen accepts. A new address gets an identity on
 * this call (`create_user`), so there is no sign-up form beside this one to
 * fall out of step with it — signing up and signing in are the same act, and
 * the product registers the person on their first successful verify.
 *
 * **The answer is the same whether or not the address exists.** The recovery
 * route's reasoning holds here unchanged: a distinguishing response is a
 * membership oracle, unauthenticated, at any rate the caller likes.
 *
 * What DOES pass through is about the REQUEST, not the person:
 *   429  GoTrue throttles this mail (one per address per minute by default)
 *        — "nothing happened" would send somebody to press again, the one
 *        action guaranteed to keep it failing;
 *   400  a malformed address, refused before any mail is considered;
 *   422  signups are switched off on the project — a fact about the
 *        platform, worth the sentence GoTrue sends.
 */
export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await readJson(request);
  } catch (error) {
    return errorResponse(error);
  }
  const email = body.email?.trim();
  if (!email) {
    return Response.json({ error: "email is required", kind: "invalid" }, { status: 400 });
  }

  /* the fallback landing for a template still using GoTrue's own link:
     it arrives with the session in the URL FRAGMENT, which this app refuses to
     read (M1), so the page says "type the code instead" rather than nothing */
  const origin = new URL(request.url).origin;
  const locale = (await cookies()).get("NEXT_LOCALE")?.value === "fa" ? "fa" : "en";

  try {
    await requestEmailCode(email, `${origin}/${locale}/sign-in?confirmed=fragment`);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 429) {
        return Response.json({ error: error.message, kind: "rate_limited" }, { status: 429 });
      }
      if (error.status === 400 || error.status === 422) {
        return Response.json({ error: error.message, kind: "invalid" }, { status: error.status });
      }
    }
    // an upstream failure must not read as "that address has no account"
    return Response.json({ ok: true });
  }
}
