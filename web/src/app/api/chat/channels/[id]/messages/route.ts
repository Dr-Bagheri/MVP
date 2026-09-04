/* 0184 — a channel's messages. The query params are FORWARDED rather than
   re-derived: `before` pages the scrollback and `after` is the catch-up read
   the stream leans on, and both are the server's to interpret. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const incoming = new URL(request.url).searchParams;
    const params = new URLSearchParams();
    for (const key of ["before", "after"]) {
      const value = incoming.get(key);
      if (value !== null) params.set(key, value);
    }
    const query = params.toString();
    return Response.json(await coreFetch(
      `/v1/chat/channels/${encodeURIComponent(id)}/messages${query ? `?${query}` : ""}`,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(
      await coreFetch(`/v1/chat/channels/${encodeURIComponent(id)}/messages`, {
        method: "POST", body: await request.json(),
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
