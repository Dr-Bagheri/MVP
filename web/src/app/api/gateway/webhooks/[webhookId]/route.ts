import { coreFetch, errorResponse } from "@/server/core";
import type { GatewayWebhook } from "@/api/types";

/** Pause / resume. Disabling keeps the subscription and its delivery history. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ webhookId: string }> },
) {
  const { webhookId } = await params;
  const { enabled } = (await request.json()) as { enabled: boolean };
  try {
    return Response.json(
      await coreFetch<GatewayWebhook>(`/v1/gateway/webhooks/${webhookId}`, {
        method: "PATCH",
        body: { enabled },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
