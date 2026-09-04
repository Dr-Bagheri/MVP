/* 0184 — one channel. No DELETE: a channel is archived, which is a PATCH. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/chat/channels/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
