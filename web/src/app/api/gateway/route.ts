import { coreFetch, errorResponse } from "@/server/core";
import type { GatewayConfig } from "@/api/types";

/**
 * Per-org API key + webhook (M17). The key is a credential: it is fetched
 * on demand for the admin who asked and never embedded in a page payload or
 * logged here.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<GatewayConfig>("/v1/gateway"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as { action: "regenerate" | "set_webhook"; url?: string };
  try {
    return Response.json(
      await coreFetch<GatewayConfig>("/v1/gateway", { method: "POST", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
