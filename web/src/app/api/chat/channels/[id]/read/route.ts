/* 0184 — the read cursor. The server applies greatest(), so a stale client
   replaying an old acknowledgement cannot move anybody's cursor backwards. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/chat/channels/${encodeURIComponent(id)}/read`, {
      method: "POST", body: await request.json(),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
