import { cookies } from "next/headers";
import { coreFetch } from "@/server/core";

const PROVIDERS = new Set(["google", "microsoft"]);

interface OAuthCookie {
  state?: unknown;
  verifier?: unknown;
  locale?: unknown;
}

function cookieName(provider: string): string {
  return `echo_connector_${provider}`;
}

function destination(request: Request, locale: string, query: string): URL {
  return new URL(`/${locale}/workflows${query}`, request.url);
}

/** Completes OAuth under the existing BFF session; core validates the exact callback URL and exchanges the code. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!PROVIDERS.has(provider)) return Response.redirect(destination(request, "en", "?connector=invalid"));
  const url = new URL(request.url);
  const store = await cookies();
  const raw = store.get(cookieName(provider))?.value;
  store.delete(cookieName(provider));
  let saved: OAuthCookie = {};
  try { saved = raw ? JSON.parse(raw) as OAuthCookie : {}; } catch { saved = {}; }
  const locale = saved.locale === "fa" ? "fa" : "en";
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.has("error") || !code || !state || state !== saved.state || typeof saved.verifier !== "string") {
    return Response.redirect(destination(request, locale, "?connector=cancelled"));
  }
  try {
    const redirectUri = `${url.origin}/api/connectors/${provider}/callback`;
    await coreFetch(`/v1/connectors/${provider}/complete`, {
      method: "POST", body: { code, code_verifier: saved.verifier, redirect_uri: redirectUri },
    });
    return Response.redirect(destination(request, locale, `?connected=${provider}`));
  } catch {
    // OAuth failure text can contain provider detail; keep it out of the URL
    // and let the workflows screen show the bounded state on the next read.
    return Response.redirect(destination(request, locale, "?connector=failed"));
  }
}
