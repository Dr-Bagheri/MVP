/* 0148 — mint the meeting's video room: a verbatim forward, the session
   attached server-side. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/room`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
