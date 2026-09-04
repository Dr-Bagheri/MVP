/* 0186 — a task's repeating schedule. PUT sets or replaces, DELETE removes.
   No PATCH: a schedule has three fields and a partial one is a shape the
   server would have to merge, which is where two spellings of "unlimited"
   would come from. */
import { coreFetch, errorResponse } from "@/server/core";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    /*
     * AN UNREADABLE BODY IS A REFUSAL, NOT A FAULT.
     *
     * `await request.json()` on an empty or malformed body throws, and every
     * throw in this file lands in `errorResponse`'s fallback as a 500 —
     * "unexpected", the status that pages somebody. Found by probing the
     * deployed route with no body at all: it answered 500 where the caller
     * had simply sent nothing, and a 500 for a bad request is the kinds-of-
     * nothing rule at the network's edge.
     *
     * 400 with a code, so the client can tell "you sent nonsense" from "we
     * broke" — and so an unauthenticated caller is not told the second thing
     * about the first.
     */
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "unreadable body", kind: "validation", code: "bad_body" },
        { status: 400 },
      );
    }
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
