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

const CORE_URL = process.env.CORE_API_URL ?? "http://127.0.0.1:8080";

/** What core/'s auth layer can refuse with, mapped to HTTP for the client. */
export type CoreErrorKind =
  | "unauthenticated"
  | "pending"
  | "suspended"
  | "forbidden"
  | "not_found"
  | "upstream";

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

export class CoreError extends Error {
  constructor(
    readonly kind: CoreErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CoreFetchInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Streaming routes (SSE) hand the response back untouched. */
  raw?: boolean;
}

export async function coreFetch<T>(path: string, init: CoreFetchInit = {}): Promise<T> {
  const session = await readSession();
  if (!session) throw new CoreError("unauthenticated", 401, "no session");

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
        authorization: `Bearer ${session.accessToken}`,
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
    throw new CoreError("unauthenticated", 401, "token rejected");
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
  if (!response.ok) {
    throw new CoreError("upstream", response.status, await safeDetail(response));
  }

  return (init.raw ? response : await response.json()) as T;
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
    return Response.json({ error: error.message, kind: error.kind }, { status: error.status });
  }
  return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
}
