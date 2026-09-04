/* 0181 — one project; 0191 gave it a DELETE.
   The comment that stood here said there was none "because there is none on
   the server and none in the schema", which was true and is the reason the
   button could not exist: the grant had to move first. Archiving is still a
   PATCH and still the gentler act; deleting removes the project and leaves
   the board's folder and the room's conversation behind. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/projects/${encodeURIComponent(id)}`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/projects/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await coreFetch(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
