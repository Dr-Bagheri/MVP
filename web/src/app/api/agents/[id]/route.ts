import { coreFetch, errorResponse, readJson } from "@/server/core";
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
        /* the PARSED body. Stringified twice (2026-09-03 → 09-06) core saw
           every column as absent, coalesced each to its old value and
           answered 200 with the unchanged row — a save reporting success. */
        body: await readJson(request),
      },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
