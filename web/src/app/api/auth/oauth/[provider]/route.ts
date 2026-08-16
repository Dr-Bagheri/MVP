import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { OAUTH_PROVIDERS, oauthAuthorizeUrl, type OAuthProvider } from "@/server/supabase";

/**
 * Start an OAuth sign-in (Google / GitHub). GET, because it is a navigation:
 * the browser leaves for the provider and comes back to /api/auth/callback.
 *
 * PKCE: we mint the verifier here, keep it in a short-lived httpOnly cookie
 * (the browser can carry it but never read it), and send only its SHA-256
 * challenge outward. The callback needs both halves to become a session —
 * a stolen redirect with the code alone is worthless (M1's shape again).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = new URL(request.url).origin;

  if (!(OAUTH_PROVIDERS as readonly string[]).includes(provider)) {
    // a provider we never offered is a URL we never minted
    return Response.redirect(new URL("/fa/sign-in?oauth=failed", origin), 303);
  }

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const store = await cookies();
  store.set("echo_pkce", verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    path: "/api/auth",
    maxAge: 600, // ten minutes to round-trip the provider is plenty
  });

  return Response.redirect(
    oauthAuthorizeUrl(provider as OAuthProvider, `${origin}/api/auth/callback`, challenge),
    303,
  );
}
