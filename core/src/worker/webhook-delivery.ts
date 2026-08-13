/**
 * Making the actual request, on the address guard's written contract.
 *
 * The guard states the sequence in its own docstring because the dispatcher
 * did not exist when it was written. It is followed here verbatim:
 *
 *   1. an agent whose DNS lookup is `guardedLookup` — the check happens as the
 *      socket opens, on the address actually being connected to, which is the
 *      only moment DNS rebinding cannot walk past;
 *   2. redirects followed MANUALLY, with `assertDeliverableUrl` on every
 *      `Location` — a public URL that 302s to `http://169.254.169.254/` is the
 *      classic metadata fetch, and an auto-following client performs it for us;
 *   3. hops capped, exhaustion = a failed delivery rather than a retry loop;
 *   4. a blocked address is NOT retryable — it will be blocked again, and
 *      retrying turns one refusal into a slow scan of the internal network.
 *
 * Point 4 is why `webhook_delivery.response_code` being admin-readable makes
 * this a port-scan oracle rather than merely an outbound request: whoever
 * registered the webhook reads the answer back.
 */
import https from "node:https";
import { once } from "node:events";
import {
  assertDeliverableUrl,
  BlockedAddressError,
  guardedLookup,
  MAX_DELIVERY_REDIRECTS,
} from "../net/address-guard.ts";

export interface DeliveryOutcome {
  /** HTTP status of the final hop, or null when no response was obtained. */
  status: number | null;
  /** Stable reason, used verbatim as the dead-letter error type. */
  reason: string;
  delivered: boolean;
  retryable: boolean;
}

export interface DeliveryRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

/**
 * One agent for the process. `lookup` is the control; nothing else about the
 * agent matters, and it must never be swapped for a plain one "to debug".
 */
const agent = new https.Agent({
  keepAlive: false,
  lookup: guardedLookup as unknown as typeof import("node:dns").lookup,
});

interface HopResult {
  status: number;
  location: string | null;
}

async function hop(url: URL, request: DeliveryRequest): Promise<HopResult> {
  const req = https.request(url, {
    method: "POST",
    agent,
    headers: {
      ...request.headers,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(request.body)),
    },
    timeout: request.timeoutMs ?? 10_000,
  });

  req.end(request.body);

  const [response] = (await Promise.race([
    once(req, "response"),
    once(req, "error").then(([error]) => {
      throw error;
    }),
    once(req, "timeout").then(() => {
      req.destroy();
      throw Object.assign(new Error("delivery timed out"), { code: "ETIMEDOUT" });
    }),
  ])) as [import("node:http").IncomingMessage];

  // The body is drained and discarded. We record the STATUS, never the
  // response content: an endpoint we were pointed at could echo anything, and
  // storing it would put an attacker's text into an admin's screen.
  response.resume();

  return {
    status: response.statusCode ?? 0,
    location: typeof response.headers.location === "string" ? response.headers.location : null,
  };
}

/** 2xx delivered · 408/429/5xx worth retrying · every other 4xx is permanent. */
export function classifyStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    return { status, reason: "delivered", delivered: true, retryable: false };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { status, reason: `http_${status}`, delivered: false, retryable: true };
  }
  // A 401/404/410 will still be a 401/404/410 in four minutes. Retrying it
  // wastes attempts and delays the honest "this endpoint is misconfigured".
  return { status, reason: `http_${status}`, delivered: false, retryable: false };
}

export async function deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
  let target: URL;
  try {
    target = assertDeliverableUrl(request.url);
  } catch (error) {
    if (error instanceof BlockedAddressError) {
      return { status: null, reason: "blocked_address", delivered: false, retryable: false };
    }
    throw error;
  }

  for (let redirects = 0; redirects <= MAX_DELIVERY_REDIRECTS; redirects++) {
    let result: HopResult;
    try {
      result = await hop(target, request);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") {
        // guardedLookup refused the resolved address. Never retryable: it
        // resolves to the same place, and repeating is the scan.
        return { status: null, reason: "blocked_address", delivered: false, retryable: false };
      }
      // Connection refused, DNS failure, TLS error, timeout: the endpoint may
      // genuinely be down for a minute.
      return { status: null, reason: `transport_${code ?? "error"}`, delivered: false, retryable: true };
    }

    const isRedirect = result.status >= 300 && result.status < 400 && result.location;
    if (!isRedirect) return classifyStatus(result.status);

    if (redirects === MAX_DELIVERY_REDIRECTS) {
      return { status: result.status, reason: "too_many_redirects", delivered: false, retryable: false };
    }

    // EVERY hop is re-checked. The first URL being public says nothing about
    // where it sends us next.
    try {
      target = assertDeliverableUrl(new URL(result.location!, target).toString());
    } catch (error) {
      if (error instanceof BlockedAddressError) {
        return { status: result.status, reason: "blocked_redirect", delivered: false, retryable: false };
      }
      throw error;
    }
  }

  return { status: null, reason: "too_many_redirects", delivered: false, retryable: false };
}
