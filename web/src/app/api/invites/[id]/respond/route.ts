/* 0189 — answering an invitation. The response carries the KIND and TARGET
   back, because the client navigates on accept and would otherwise have to
   remember which row it pressed across an await. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    return Response.json(
      await coreFetch(`/v1/invites/${encodeURIComponent(id)}/respond`, { method: "POST", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
