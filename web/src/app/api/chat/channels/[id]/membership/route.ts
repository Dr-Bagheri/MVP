/* 0184 — joining and leaving. A person's own row, both ways. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PUT(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/chat/channels/${encodeURIComponent(id)}/membership`, { method: "PUT" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/chat/channels/${encodeURIComponent(id)}/membership`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
