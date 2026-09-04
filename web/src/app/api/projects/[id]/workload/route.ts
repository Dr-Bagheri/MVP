/* 0186 — who is carrying what in a project. A verbatim forward; the counts
   are the server's, computed off the board under the caller's own RLS. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/projects/${encodeURIComponent(id)}/workload`));
  } catch (error) {
    return errorResponse(error);
  }
}
