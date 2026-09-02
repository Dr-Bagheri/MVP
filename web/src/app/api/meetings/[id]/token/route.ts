/* the video room's join token — a verbatim forward; the secret that signs it
   never leaves the server, and the room it names is derived there too. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(
      await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/token`, { method: "POST" }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
