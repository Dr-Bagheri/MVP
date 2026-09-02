/**
 * SERVER ONLY — the server-to-server hop to core/ (M1).
 *
 * Everything the browser asks for goes: browser → BFF route handler → here →
 * core/ api (Fastify) with a bearer token. core/ verifies the JWT and
 * re-derives membership from the DB (core/src/api/auth.ts), so this layer
 * carries identity and nothing else — it makes no authorization decisions of
 * its own.
 */
import { readSession } from "./session";

export const CORE_URL = process.env.CORE_API_URL ?? "http://127.0.0.1:8080";

/** What core/'s auth layer can refuse with, mapped to HTTP for the client. */
export type CoreErrorKind =
  | "unauthenticated"
  | "no_token"
  | "bad_signature"
  | "unknown_actor"
  | "bad_key"
  | "pending"
  | "suspended"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "upstream";

/**
 * The 401 kinds core/ declares. Same status and same `error` string as
 * before — only `kind` is new — so nothing keying off the old shape breaks.
 *
 * These are four different facts that used to be one:
 * - `no_token`       nothing presented.
 * - `bad_signature`  the token did not verify — **the trust roots differ**.
 *   This is the one that says "core/ is on the smoke secret while Supabase
 *   signs with the project key" instead of sending whoever is debugging into
 *   the auth layer, which is the component least likely to be wrong.
 * - `unknown_actor`  verified, real person, no `app_user` row — since
 *   `/v1/signup` exists this means **has not registered yet**, not "the seed
 *   data is broken".
 * - `bad_key`        an M17 gateway key that did not resolve. Deliberately
 *   ONE kind for unknown / revoked / expired / disabled-owner: splitting it
 *   would make the endpoint an oracle for which keys exist.
 */
const DECLARED_401: readonly string[] = ["no_token", "bad_signature", "unknown_actor", "bad_key"];

/**
 * The 403 kinds core/ declares. All three are the same HTTP status and mean
 * different things to a person:
 * - `pending`   — M15, waiting for an org admin to accept you.
 * - `suspended` — your ORG is switched off. Distinct because "awaiting
 *   activation" points the user at an admin who cannot help them; suspension
 *   resolves with the vendor. Added to the taxonomy, not renamed from
 *   anything, so nothing built against the earlier two breaks.
 * - `forbidden` — you are active and this simply isn't yours.
 */
const DECLARED_403: readonly string[] = ["pending", "suspended", "forbidden"];

/**
 * The REFUSALS core/ declares on a write — `400 {kind:"invalid"}` and
 * `409 {kind:"conflict"}` (core/src/api/errors.ts).
 *
 * Without these two, both fell through to the catch-all below and reached the
 * browser labelled `upstream` — the kind this file documents as "core/ is not
 * answering". A form that keys off `kind` would then offer a RETRY for a
 * username that is already taken: the one refusal where retrying the same
 * value is guaranteed to fail again, forever.
 *
 * The status alone is not the whole answer, because the two kinds are how a
 * form decides WHERE the message goes: `conflict` belongs on the username
 * field specifically, `invalid` belongs wherever the sentence points. So the
 * kind is read from the body like the 401/403 paths do, with the status as
 * the fallback for a body that predates it.
 */
const DECLARED_4XX: Readonly<Record<number, CoreErrorKind>> = { 400: "invalid", 409: "conflict" };

export class CoreError extends Error {
  constructor(
    readonly kind: CoreErrorKind,
    readonly status: number,
    message: string,
    /**
     * core/'s own refusal CODE, when it catalogued one.
     *
     * The house rule is code-plus-params and localize at the reader: core
     * owns the rule, the screen owns the language, and a translated sentence
     * from the server would be the wrong altitude. That only works if the
     * code survives the hop — it used to stop here, so a screen wanting to
     * say something specific had to match on English prose or settle for its
     * generic wording. `meet_scope_missing` is the case that found it: the
     * refusal is "this connection may read your calendar but not write to
     * it", and the generic wording sent someone to check a connection that
     * was working.
     */
    readonly code?: string,
  ) {
    super(message);
  }
}

interface CoreFetchInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Streaming routes (SSE) hand the response back untouched. */
  raw?: boolean;
  /**
   * The GUEST door, and nothing else (0158): a route whose authorisation is
   * the code in its own path, taken by someone who has no account and never
   * will. Every other route here demands a session, which is why this is an
   * explicit opt-in rather than a fallback — a missing session must keep
   * meaning 401, or an auth bug becomes an anonymous call.
   */
  anonymous?: boolean;
}

export async function coreFetch<T>(path: string, init: CoreFetchInit = {}): Promise<T> {
  const session = await readSession();
  if (!session && init.anonymous !== true) {
    throw new CoreError("unauthenticated", 401, "no session");
  }

  /*
   * A failed fetch — core/ down, DNS, connection refused — is an UPSTREAM
   * failure, and must not arrive looking like a bug in this layer. Uncaught,
   * it fell through `errorResponse`'s catch-all as
   * `500 {"error":"unexpected"}`, byte-identical to what a genuine crash in a
   * route handler produces. Distinguishing them matters at 3am: 502 says
   * "core/ is not answering", 500 says "we broke". Found the honest way, by
   * having core/ stop underneath a live check.
   */
  let response: Response;
  try {
    response = await fetch(`${CORE_URL}${path}`, {
      ...init,
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (cause) {
    throw new CoreError(
      "upstream",
      502,
      `core/ unreachable at ${CORE_URL}: ${cause instanceof Error ? cause.message : "fetch failed"}`,
    );
  }

  if (response.status === 401) {
    // read the declared kind rather than flattening four facts into one
    const body = await safeBody(response);
    const declared = DECLARED_401.includes(body.kind ?? "") ? (body.kind as CoreErrorKind) : null;
    throw new CoreError(declared ?? "unauthenticated", 401, body.error ?? "token rejected");
  }
  if (response.status === 403) {
    /*
     * M15 pending vs an admin-only route. core/ now DECLARES which, so read
     * its `kind` rather than sniffing the message — the regex below was a
     * re-derivation of someone else's rule, and it would have silently
     * reclassified a pending account as `forbidden` the day the Persian
     * string was reworded. The fallback stays only for a 403 that predates
     * the declared kind; it is not the primary path.
     */
    const body = await safeBody(response);
    const detail = body.error ?? body.message ?? `HTTP ${response.status}`;
    const declared = DECLARED_403.includes(body.kind ?? "") ? (body.kind as CoreErrorKind) : null;
    throw new CoreError(declared ?? (/activat|pending/i.test(detail) ? "pending" : "forbidden"), 403, detail);
  }
  if (response.status === 404) {
    /*
     * A 404 is an ANSWER here, not a fault. core/ returns it both for a row
     * the caller cannot see and for one that does not exist — deliberately
     * indistinguishable, so that probing ids leaks nothing. Letting it fall
     * through to `upstream` would tell the UI "something broke" when the
     * truth is "there is nothing here for you", and those are different
     * screens: one offers a retry, the other must not.
     */
    throw new CoreError("not_found", 404, await safeDetail(response));
  }
  const declared4xx = DECLARED_4XX[response.status];
  if (declared4xx) {
    /*
     * The MESSAGE is the payload here, not an afterthought. core/ owns the
     * username rule and states it in the refusal ("3–32 lowercase…", "already
     * taken", "retired") precisely so a client does not have to mirror the
     * regex — and a mirrored rule is one that drifts silently the day the
     * constraint changes, telling the user their valid name is invalid.
     */
    const body = await safeBody(response);
    const kind = body.kind === "invalid" || body.kind === "conflict" ? body.kind : declared4xx;
    throw new CoreError(
      kind, response.status,
      body.error ?? body.message ?? `HTTP ${response.status}`,
      typeof body.code === "string" ? body.code : undefined,
    );
  }
  if (!response.ok) {
    throw new CoreError("upstream", response.status, await safeDetail(response));
  }

  if (init.raw) return response as T;
  /*
   * A 204 has no body BY DEFINITION — json() on it throws, and that throw
   * used to fall into the route's catch and reach the browser as a 500:
   * the delete succeeded, the table refreshed, and a toast reported "That
   * didn't go through" about an operation that went through (user report,
   * 2026-08-21, with the screenshot to prove it). Core answers 204 from
   * five routes; this one line covers them all.
   */
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

/** Same hop, but returns the raw Response so SSE can be piped through. */
export function coreStream(path: string, body: unknown): Promise<Response> {
  return coreFetch<Response>(path, {
    method: "POST",
    body,
    headers: { accept: "text/event-stream" },
    raw: true,
  });
}

interface CoreErrorBody {
  error?: string;
  message?: string;
  kind?: string;
  /** core/'s catalogued refusal code, when the refusal has one */
  code?: string;
}

async function safeBody(response: Response): Promise<CoreErrorBody> {
  try {
    return (await response.json()) as CoreErrorBody;
  } catch {
    return {};
  }
}

async function safeDetail(response: Response): Promise<string> {
  const body = await safeBody(response);
  return body.error ?? body.message ?? `HTTP ${response.status}`;
}

/** One place that turns a CoreError into the JSON the client layer expects. */
export function errorResponse(error: unknown): Response {
  if (error instanceof CoreError) {
    return Response.json(
      /* omitted rather than sent as null, so a screen can ask whether this
         refusal is catalogued at all — the shape core/ uses upstream */
      { error: error.message, kind: error.kind, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    );
  }
  return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
}
