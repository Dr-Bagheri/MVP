import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/[id]/finish — recording is over, the pipeline owns the
 * call now (`recording` → `processing`). Finishing twice returns the same
 * answer; core treats it as an idempotent read, not a fault.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/calls/${id}/finish`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
