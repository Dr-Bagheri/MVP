import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { AuthError, ssoAuthorizeUrl } from "@/server/supabase";
import { errorResponse, readJson } from "@/server/core";

/**
 * POST /api/auth/sso — start a single sign-on (SAML) round trip from a work
 * email's DOMAIN (user directive, 2026-09-16: "Continue with SSO").
 *
 * The same PKCE shape as `/api/auth/oauth/:provider`, and for the same reason
 * (M1): the verifier lives in an httpOnly cookie, only its challenge leaves,
 * and the identity provider's answer lands on `/api/auth/callback` as an
 * opaque `?code=` the server exchanges. The browser never holds a token.
 *
 * POST rather than GET because the domain is INPUT rather than a path: a GET
 * with the address in the query would put somebody's email into every log
 * line between here and the provider.
 *
 * Two refusals are named apart, because they ask for different things back:
 *   - `disabled`: the operator has not switched SSO on (db/0225's row) —
 *     the sentence, never a provider's raw page;
 *   - `not_configured`: GoTrue has no identity provider for that domain —
 *     the person's organisation has not set SSO up with the platform.
 * Everything else is the upstream's fault and says so.
 */
export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await readJson(request);
  } catch (error) {
    return errorResponse(error);
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : email;
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return Response.json({ error: "a work email or its domain is required", kind: "invalid" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  /* db/0078 + db/0225: SSO is a switch, and pressing an off switch answers
     with the sentence; an unreachable settings read falls open, as the
     oauth start route does (M21 — the outage must not lock every door) */
  try {
    const res = await fetch(`${origin}/api/auth-methods`, { cache: "no-store" });
    const methods = (await res.json()) as { provider: string; enabled: boolean }[];
    const row = methods.find((m) => m.provider === "sso");
    if (row && !row.enabled) {
      return Response.json({ error: "single sign-on is not switched on", kind: "invalid", code: "disabled" }, { status: 400 });
    }
  } catch { /* fall open */ }

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  try {
    const url = await ssoAuthorizeUrl(domain, `${origin}/api/auth/callback`, challenge);
    const store = await cookies();
    store.set("echo_pkce", verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https"),
      path: "/api/auth",
      maxAge: 600,
    });
    return Response.json({ url });
  } catch (error) {
    if (error instanceof AuthError && (error.status === 400 || error.status === 404 || error.status === 422)) {
      /* GoTrue: no SSO provider for this domain — a fact about the
         organisation, said as one; never the provider's sentence */
      return Response.json({ error: "no single sign-on for this domain", kind: "invalid", code: "not_configured" }, { status: 400 });
    }
    return errorResponse(error);
  }
}
