import { AuthError, requestPasswordRecovery } from "@/server/supabase";

/**
 * "Send me a recovery email."
 *
 * **The answer is the same whether or not the account exists**, and that is
 * the design rather than an oversight. A distinguishing response turns this
 * into a membership oracle: anyone with a list of addresses could ask which of
 * them have accounts here, unauthenticated, at any rate they like. GoTrue is
 * already careful about this; adding "no account found" on top would undo it.
 *
 * So the caller shows "if that address has an account, the mail is on its
 * way", and that sentence is literally true rather than a polite evasion.
 *
 * The link lands on OUR reset page, not a Supabase-hosted one, because the
 * token must be consumed server-side to keep it out of the browser (M1). That
 * depends on the project's email template using `{{ .TokenHash }}` — see
 * `verifyRecoveryToken`.
 */
export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  if (!email) {
    return Response.json({ error: "email is required", kind: "invalid" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  try {
    await requestPasswordRecovery(email, `${origin}/fa/reset`);
    return Response.json({ ok: true });
  } catch (error) {
    /*
     * A rate limit is worth passing through — GoTrue throttles recovery mail
     * hard, and "nothing happened" for a 429 sends someone to request it again,
     * which is the one action guaranteed to keep it failing.
     */
    if (error instanceof AuthError && error.status === 429) {
      return Response.json({ error: error.message, kind: "rate_limited" }, { status: 429 });
    }
    /*
     * Everything else answers OK. An upstream failure must not become "that
     * address has no account" — the fallback has to fail in the direction that
     * leaks nothing, and the person retries rather than concluding they used
     * the wrong address.
     */
    return Response.json({ ok: true });
  }
}
