import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE } from "./server/session-cookie";

const intl = createMiddleware(routing);

/**
 * The platform's front door is the LOGIN PAGE (user directive, 2026-08-16;
 * hardened 2026-08-18): without a session, no page renders — not the hub, not
 * a settings screen, not a fixture-backed table that would LOOK like the
 * product to a stranger. A direct URL to any surface lands on sign-in.
 *
 * Only the auth surfaces stay reachable signed out — they are how a session
 * comes to exist. Everything else redirects to sign-in, locale preserved.
 *
 * **What "has a session" means here — the hardening.** The first gate checked
 * only the cookie's PRESENCE, and the cookie outlives the token it carries by
 * 29 days: an hour after sign-in, the shell still opened while every data
 * call 401'd — "the gate not working", experienced exactly as reported. The
 * gate now reads the cookie's contents:
 *
 *   - unparsable or token-less  → not a session; redirect + delete the cookie
 *     (a cookie we cannot read is not one we keep re-reading forever);
 *   - access token still live   → pass;
 *   - expired, refresh token    → refresh against GoTrue HERE, at the edge,
 *     and set the renewed cookie on this very response — the person walks in
 *     without ever seeing a bounce;
 *   - refresh REFUSED           → the session is terminated (signed out,
 *     revoked, rotated elsewhere); redirect to sign-in + delete the cookie.
 *
 * It is still the door, not the wall — identity, role and status are verified
 * by core/ on every data call (invariant 2), so a forged cookie buys a shell
 * whose every request 401s. But the door now closes when the session ends,
 * not 29 days later.
 */
/*
 * For a few hours on 2026-09-05 this list also held `/home` — a marketing page
 * inside this app, with the bare root sending signed-out visitors to it. The
 * user kept the company's own site at neurai.pt instead, so the page is gone
 * and the rule is what it was: the root is a surface, and a surface asks for
 * sign-in. If a public page ever returns here, its test is the ROOT redirect,
 * not the page — the page renders identically gated or not.
 */
const OPEN = ["/sign-in", "/sign-up", "/forgot", "/reset", "/pending", "/suspended"];

/** Refresh when inside this window of expiry, so the token survives the hop. */
const REFRESH_MARGIN_MS = 60_000;

interface CookieSession {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

type GateVerdict =
  | { state: "open" }
  | { state: "renewed"; cookieValue: string }
  | { state: "closed" };

async function assessSession(raw: string | undefined): Promise<GateVerdict> {
  if (!raw) return { state: "closed" };

  let session: CookieSession;
  try {
    session = JSON.parse(raw) as CookieSession;
  } catch {
    return { state: "closed" };
  }
  if (!session.accessToken) return { state: "closed" };

  const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : 0;
  if (Date.now() < expiresAt - REFRESH_MARGIN_MS) return { state: "open" };
  if (!session.refreshToken) return { state: "closed" };

  /*
   * NEXT_PUBLIC_* values are inlined at build time, so they exist in the edge
   * bundle. The publishable key is public by design (it ships in every
   * browser bundle of every Supabase app) — using it here leaks nothing.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Unconfigured auth cannot mint sessions either — fail toward the gate.
    return { state: "closed" };
  }

  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
      cache: "no-store",
    });
    if (!response.ok) {
      /*
       * 4xx = GoTrue REFUSED the refresh token: revoked at sign-out, already
       * rotated, or expired — a terminated session, and the gate closes. A
       * 5xx is GoTrue failing, not the session ending: let an unexpired
       * token through rather than signing the whole userbase out during an
       * auth-provider blip.
       */
      if (response.status >= 500 && Date.now() < expiresAt) return { state: "open" };
      return { state: "closed" };
    }
    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token || !tokens.refresh_token) return { state: "closed" };
    return {
      state: "renewed",
      cookieValue: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      }),
    };
  } catch {
    // could not ASK — network, not a refusal; honour an unexpired token
    return Date.now() < expiresAt ? { state: "open" } : { state: "closed" };
  }
}

/** Must mirror `writeSession` in server/session.ts — one cookie, one shape. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export default async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const parts = path.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(parts[0] ?? "");
  const locale = hasLocale ? parts[0]! : routing.defaultLocale;
  const rest = "/" + (hasLocale ? parts.slice(1) : parts).join("/");

  const isOpen = OPEN.some((o) => rest === o || rest.startsWith(`${o}/`));

  if (!isOpen) {
    const verdict = await assessSession(request.cookies.get(SESSION_COOKIE)?.value);

    if (verdict.state === "closed") {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/sign-in`;
      url.search = "";
      const redirect = NextResponse.redirect(url);
      // a cookie that failed the gate is dead weight — stop carrying it
      redirect.cookies.delete(SESSION_COOKIE);
      return redirect;
    }

    const response = intl(request);
    if (verdict.state === "renewed") {
      response.cookies.set(SESSION_COOKIE, verdict.cookieValue, COOKIE_OPTIONS);
    }
    /*
     * Authenticated pages are never HTTP-cached: a cached copy outlives the
     * session that authorized it, and the Back button after sign-out would
     * serve it without this gate ever running. `no-store` forces history
     * navigations to revalidate (where the redirect above catches them);
     * the bfcache half is closed by sign-out's Clear-Site-Data.
     */
    response.headers.set("cache-control", "no-store, must-revalidate");
    return response;
  }

  return intl(request);
}

export const config = {
  // everything except Next internals, BFF routes and static files
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
