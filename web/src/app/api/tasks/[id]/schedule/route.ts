/* 0186 — a task's repeating schedule. PUT sets or replaces, DELETE removes.
   No PATCH: a schedule has three fields and a partial one is a shape the
   server would have to merge, which is where two spellings of "unlimited"
   would come from. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    /*
     * AN UNREADABLE BODY IS A REFUSAL, NOT A FAULT. Found by probing the
     * deployed route with no body at all: it answered 500 where the caller
     * had simply sent nothing. The hand-rolled try/catch that first fixed it
     * here became `readJson` — the ONE spelling, in @/server/core — whose
     * CoreError the catch below turns into the 400 `bad_body` it is.
     */
    const body = await readJson(request);
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/schedule`, {
      method: "PUT", body,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/schedule`, {
      method: "DELETE",
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
