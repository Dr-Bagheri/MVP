import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { coreFetch, errorResponse } from "@/server/core";

const PROVIDERS = new Set(["google", "microsoft"]);

function cookieName(provider: string): string {
  return `echo_connector_${provider}`;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Starts OAuth from the authenticated BFF, retaining PKCE only in an HttpOnly, short-lived cookie. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    if (!PROVIDERS.has(provider)) return Response.json({ error: "unknown provider" }, { status: 400 });
    const body = await request.json() as { locale?: unknown };
    const locale = body.locale === "fa" ? "fa" : "en";
    const verifier = base64Url(randomBytes(64));
    const state = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const redirectUri = `${new URL(request.url).origin}/api/connectors/${provider}/callback`;
    const result = await coreFetch<{ authorization_url: string }>(
      `/v1/connectors/${provider}/authorization`,
      { method: "POST", body: { state, code_challenge: challenge, redirect_uri: redirectUri } },
    );
    const store = await cookies();
    store.set(cookieName(provider), JSON.stringify({ state, verifier, locale }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/connectors/${provider}`,
      maxAge: 10 * 60,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
