import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/[id]/restore — undo a soft delete inside the purge
 * window. Admin-only by the user's own ruling (deletion should feel like
 * deletion); core enforces, this forwards. A non-admin gets core's 404 —
 * deliberately indistinguishable from "no such call".
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/calls/${id}/restore`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
