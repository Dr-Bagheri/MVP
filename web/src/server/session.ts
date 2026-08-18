/**
 * SERVER ONLY — never import from a "use client" module.
 *
 * M1: web/ is UI + BFF and the session lives here; the browser holds an
 * httpOnly cookie and never a token. This module is the single place the
 * access token is read, so no route handler can accidentally leak it into a
 * response body.
 */
import { cookies } from "next/headers";
import { refresh } from "./supabase";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };

export interface Session {
  /** Supabase-issued JWT — core/ verifies it and re-derives membership. */
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Refresh when the access token is inside this window of its expiry. The
 * margin exists so a token that will die MID-REQUEST (verified here, expired
 * by the time core/ sees it) is renewed before the hop, not after the 401.
 */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Read the session — and keep it ALIVE.
 *
 * The access token Supabase issues lives about an hour; the cookie lives 30
 * days. Reading the cookie without honouring that difference produced the
 * gate's worst behaviour: an hour after sign-in every data call 401'd while
 * the presence-checked cookie still opened the shell — signed in by the door's
 * measure, signed out by every wall behind it. Two different answers to "is
 * this person signed in" is the exact drift a single reader exists to prevent.
 *
 * So the ONE reader refreshes: expired-or-expiring token + live refresh token
 * → a new token set from GoTrue, persisted back into the cookie where the
 * caller's context allows a write (route handlers do; a Server Component
 * render does not, and the freshened session is still returned for THIS
 * request — the write lands on the next handler call).
 *
 * A refresh REFUSED by GoTrue (revoked, rotated-and-reused, signed out
 * elsewhere) is a terminated session and answers null — the caller treats it
 * exactly as no cookie at all. A refresh that failed to REACH GoTrue keeps
 * the current session: a network blip must not sign everyone out.
 */
export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  let session: Session;
  try {
    session = JSON.parse(raw) as Session;
    if (!session.accessToken) return null;
  } catch {
    return null;
  }

  if (Date.now() < session.expiresAt - REFRESH_MARGIN_MS) return session;
  if (!session.refreshToken) return null;

  try {
    const tokens = await refresh(session.refreshToken);
    const renewed: Session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    try {
      await writeSession(renewed);
    } catch {
      // Server Component render: cookies are read-only here. The renewed
      // session still serves this request; persistence rides the next
      // route-handler call (and the middleware refreshes on navigation).
    }
    return renewed;
  } catch (error) {
    // 4xx = GoTrue REFUSED the token: the session is over, say so.
    // Anything else = we could not ask: keep the session we have.
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) return null;
    return Date.now() < session.expiresAt ? session : null;
  }
}

export async function writeSession(session: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
