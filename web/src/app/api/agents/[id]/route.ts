import { coreFetch, errorResponse } from "@/server/core";
import type { AgentCard } from "@/api/types";

/** Edit one agent (M47). The wall is core's — a row this caller may not write
    answers not-found, and this layer neither knows nor decides that. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(await coreFetch<AgentCard>(
      `/v1/agents/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await request.json()),
      },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
