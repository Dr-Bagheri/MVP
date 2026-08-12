import { coreFetch, errorResponse } from "@/server/core";

/**
 * Revoke — NOT delete. The row survives with `revoked_at` set, so the record
 * of what existed, who it acted as, and when it stopped remains auditable.
 * 204 from core/, so there is no body to forward.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const { keyId } = await params;
  try {
    await coreFetch<void>(`/v1/gateway/keys/${keyId}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
