/* 0186 — a task's repeating schedule. PUT sets or replaces, DELETE removes.
   No PATCH: a schedule has three fields and a partial one is a shape the
   server would have to merge, which is where two spellings of "unlimited"
   would come from. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/schedule`, {
      method: "PUT", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/schedule`, {
      method: "DELETE",
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
