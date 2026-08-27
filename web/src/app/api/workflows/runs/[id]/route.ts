import { coreFetch, errorResponse } from "@/server/core";
import type { WorkflowRunDetail } from "@/api/types";

/** M41 P1 — one run + its step ledger. Outputs ride only for the owner (W16). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<WorkflowRunDetail>(`/v1/workflows/runs/${encodeURIComponent(id)}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
