import { coreFetch, errorResponse } from "@/server/core";
import type { AuthoredWorkflow } from "@/api/types";

/** M41 P5/W32 — pause, rename, trigger, ROLLBACK. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<AuthoredWorkflow>(
        `/v1/workflows/manage/${encodeURIComponent(id)}`,
        { method: "PATCH", body: await request.json() },
      ));
  } catch (error) {
    return errorResponse(error);
  }
}
