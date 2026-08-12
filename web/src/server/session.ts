/**
 * SERVER ONLY — never import from a "use client" module.
 *
 * M1: web/ is UI + BFF and the session lives here; the browser holds an
 * httpOnly cookie and never a token. This module is the single place the
 * access token is read, so no route handler can accidentally leak it into a
 * response body.
 */
import { cookies } from "next/headers";

export const SESSION_COOKIE = "echo_session";

export interface Session {
  /** Supabase-issued JWT — core/ verifies it and re-derives membership. */
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session.accessToken ? session : null;
  } catch {
    return null;
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
