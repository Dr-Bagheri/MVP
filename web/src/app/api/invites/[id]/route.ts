/* 0189 — the inviter takes one back. The invitee's "no" is the declined
   STATE and goes through /respond; this is only ever the sender. */
import { coreFetch, errorResponse } from "@/server/core";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
