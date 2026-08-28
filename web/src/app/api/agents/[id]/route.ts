import { coreFetch, errorResponse } from "@/server/core";
import type { AgentCard } from "@/api/types";

/**
 * M47 — edit an agent. The body is forwarded as-is: core validates field by
 * field and RLS is the wall — an agent the caller may not edit (a member on
 * an org agent, anyone on a system one) updates nothing and answers the same
 * not-found as a row that never existed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<AgentCard>(`/v1/agents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: await request.json(),
      }));
  } catch (error) {
    return errorResponse(error);
  }
}
