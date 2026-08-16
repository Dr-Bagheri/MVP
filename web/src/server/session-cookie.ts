/**
 * The session cookie's NAME, alone in its own module.
 *
 * The middleware (edge runtime) needs the name to gate routes, and
 * `session.ts` imports `next/headers` — a server-only module the edge bundle
 * must not pull in. One exported constant, imported by both, keeps the name
 * from ever having two spellings (the drift shape) without the middleware
 * inheriting server-only dependencies.
 */
export const SESSION_COOKIE = "echo_session";
