import { coreFetch, errorResponse } from "@/server/core";

/** Phase C: one run's reasoning trace — codes only, RLS decides visibility. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    return Response.json(await coreFetch(`/v1/assistant/runs/${runId}/trace`));
  } catch (error) {
    return errorResponse(error);
  }
}
