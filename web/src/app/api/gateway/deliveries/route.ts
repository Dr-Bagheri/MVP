import { coreFetch, errorResponse } from "@/server/core";
import type { GatewayDelivery } from "@/api/types";

/**
 * Delivery log — the answer to "did my endpoint actually receive it?".
 *
 * Deliveries carry identifiers and status only, never transcript or summary
 * text: a webhook is a doorbell, not a delivery. The consumer is told THAT
 * something happened and comes back through the gateway to read it, under the
 * same wall as everyone else.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["webhook_id", "limit"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";

  try {
    return Response.json(
      await coreFetch<{ deliveries: GatewayDelivery[] }>(`/v1/gateway/deliveries${suffix}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
