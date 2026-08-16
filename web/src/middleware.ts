import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE } from "./server/session-cookie";

const intl = createMiddleware(routing);

/**
 * The platform's front door is the LOGIN PAGE (user directive, 2026-08-16):
 * without a session, no page renders — not the hub, not a settings screen,
 * not a fixture-backed table that would LOOK like the product to a stranger.
 *
 * Only the auth surfaces stay reachable signed out — they are how a session
 * comes to exist. Everything else redirects to sign-in, locale preserved.
 *
 * What this gate is and is not: it checks the PRESENCE of the httpOnly
 * session cookie, which only our own server ever sets. It is the door, not
 * the wall — identity, role and status are verified by core on every data
 * call (invariant 2), so a forged cookie buys a shell whose every request
 * 401s. The deeper per-status guard (pending/suspended screens on direct
 * URLs) rides the identity swap work.
 */
const OPEN = ["/sign-in", "/sign-up", "/forgot", "/reset", "/pending", "/suspended"];

export default function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const parts = path.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(parts[0] ?? "");
  const locale = hasLocale ? parts[0]! : routing.defaultLocale;
  const rest = "/" + (hasLocale ? parts.slice(1) : parts).join("/");

  const isOpen = OPEN.some((o) => rest === o || rest.startsWith(`${o}/`));
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isOpen && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/sign-in`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return intl(request);
}

export const config = {
  // everything except Next internals, BFF routes and static files
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
