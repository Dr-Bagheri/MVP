/* 0189 — one emoji on one message. PUT presses it, DELETE takes it back; the
   PK in the schema is what makes a second press a removal rather than a
   duplicate, so there is nothing to merge on this hop. */
import { coreFetch, errorResponse } from "@/server/core";

type Ctx = { params: Promise<{ id: string; emoji: string }> };

/* the emoji travels ENCODED in the path and is re-encoded here rather than
   passed through: Next decodes route params, so forwarding the decoded form
   would put a raw multi-byte emoji into a URL and leave whether it survives
   to whatever sits between us and core */
const path = (id: string, emoji: string) =>
  `/v1/chat/messages/${encodeURIComponent(id)}/reactions/${encodeURIComponent(emoji)}`;

export async function PUT(_request: Request, ctx: Ctx) {
  try {
    const { id, emoji } = await ctx.params;
    return Response.json(await coreFetch(path(id, emoji), { method: "PUT" }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const { id, emoji } = await ctx.params;
    return Response.json(await coreFetch(path(id, emoji), { method: "DELETE" }));
  } catch (error) {
    return errorResponse(error);
  }
}
