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
export type CoreErrorKind = "unauthenticated" | "pending" | "forbidden" | "upstream";

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

  const response = await fetch(`${CORE_URL}${path}`, {
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

  if (response.status === 401) {
    throw new CoreError("unauthenticated", 401, "token rejected");
  }
  if (response.status === 403) {
    // core/ NotActivatedError — M15 pending, or admin-only route. The UI
    // turns "pending" into the waiting-for-approval wall.
    const detail = await safeDetail(response);
    const pending = /activat|pending/i.test(detail);
    throw new CoreError(pending ? "pending" : "forbidden", 403, detail);
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

async function safeDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error ?? data.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** One place that turns a CoreError into the JSON the client layer expects. */
export function errorResponse(error: unknown): Response {
  if (error instanceof CoreError) {
    return Response.json({ error: error.message, kind: error.kind }, { status: error.status });
  }
  return Response.json({ error: "unexpected", kind: "upstream" }, { status: 500 });
}
