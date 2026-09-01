/* 0145 — meetings' BFF: verbatim forwards, the session attached
   server-side. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/meetings/${encodeURIComponent(id)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
