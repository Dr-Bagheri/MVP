/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(
      await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/comments`, {
        method: "POST", body: await request.json(),
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
