import { coreFetch, errorResponse } from "@/server/core";

/** Rename a person / change their title / identify them as a member.
    Core owns the vocabulary and every wall. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      display_name?: string; title?: string; team?: string;
      /* explicit null CLEARS the account link; absent leaves it alone —
         forwarded verbatim so the BFF never decides which it was */
      app_user_id?: string | null;
    };
    return Response.json(
      await coreFetch(`/v1/directory/${id}`, { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** True delete via db/0076's definer door — admin/owner only (the SQL is
    the wall; core's requireAdmin refuses earlier and more politely). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    await coreFetch(`/v1/directory/${id}`, { method: "DELETE", body: { reason: body.reason } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
