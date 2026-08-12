import { coreFetch, errorResponse } from "@/server/core";
import type { GatewayEvent, GatewayWebhook, GatewayWebhookCreated } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<{ webhooks: GatewayWebhook[] }>("/v1/gateway/webhooks"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Create. Returns `secret` exactly once, under the same rule as a key token.
 *
 * The subscribed events are a closed set — core/ 400s an unknown one and
 * names it, precisely so a typo fails loudly instead of silently delivering
 * nothing forever. This layer forwards the list verbatim rather than
 * filtering it: a client-side allow-list would drift from the server's, and
 * swallowing a bad value here would convert a named 400 into exactly the
 * silence the server is trying to prevent.
 */
export async function POST(request: Request) {
  const { url, events } = (await request.json()) as { url: string; events: GatewayEvent[] };
  try {
    return Response.json(
      await coreFetch<GatewayWebhookCreated>("/v1/gateway/webhooks", {
        method: "POST",
        body: { url, events },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
