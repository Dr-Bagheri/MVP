/* 0184 — editing and tombstoning one message. No DELETE method here because
   there is none in the schema: the row stays and the words go. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/chat/messages/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
