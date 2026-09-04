/* 0189 — answering an invitation. The response carries the KIND and TARGET
   back, because the client navigates on accept and would otherwise have to
   remember which row it pressed across an await. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "unreadable body", kind: "validation", code: "bad_body" },
        { status: 400 },
      );
    }
    return Response.json(
      await coreFetch(`/v1/invites/${encodeURIComponent(id)}/respond`, { method: "POST", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
