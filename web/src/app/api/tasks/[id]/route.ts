/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

/* 0162: the board's true delete — a verbatim forward like the rest; the
   creator-or-admin rule and the one-sentence refusal are the door's */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
