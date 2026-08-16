import { coreFetch, errorResponse } from "@/server/core";
import type { Invitation } from "@/api/types";

/** Revoke — the only edit an invitation has (terms are immutable, D24). */
export async function POST(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  try {
    return Response.json(
      await coreFetch<Invitation>(`/v1/admin/invitations/${invitationId}/revoke`, {
        method: "POST",
        body: {},
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
