/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/assign-me`, { method: "POST" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/assign-me`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
