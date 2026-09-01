/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await ctx.params;
    await coreFetch(`/v1/tasks/checklist/${encodeURIComponent(itemId)}`, {
      method: "PATCH", body: await request.json(),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await ctx.params;
    await coreFetch(`/v1/tasks/checklist/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
