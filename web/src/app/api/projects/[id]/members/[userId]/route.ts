/* 0181 — who is on a project. Verbatim forwards; the membership rule is the
   server's. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PUT(_request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    await coreFetch(`/v1/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "PUT" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const { id, userId } = await ctx.params;
    await coreFetch(`/v1/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
