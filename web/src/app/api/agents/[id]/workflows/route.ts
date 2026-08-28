import { coreFetch, errorResponse } from "@/server/core";
import type { AgentWorkflowLink } from "@/api/types";

/** M47 — what an agent carries, for the overview that opens with it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ workflows: AgentWorkflowLink[] }>(
        `/v1/agents/${encodeURIComponent(id)}/workflows`));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Whole-set write ({ workflow_ids }), the producer's own contract — the
 * client sends the membership it means, not a diff, and core answers with
 * the set as it now stands so the screen adopts the server's truth.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ workflows: AgentWorkflowLink[] }>(
        `/v1/agents/${encodeURIComponent(id)}/workflows`, {
          method: "PUT",
          body: await request.json(),
        }));
  } catch (error) {
    return errorResponse(error);
  }
}
