/* 0147 — the board's labels, history and roster: verbatim forwards, the
   session attached server-side. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PUT(_request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/assignees/${encodeURIComponent(userId)}`, { method: "PUT" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/assignees/${encodeURIComponent(userId)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
