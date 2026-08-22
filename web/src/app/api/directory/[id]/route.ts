import { coreFetch, errorResponse } from "@/server/core";

/** Rename a person / change their title. Core owns the vocabulary. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { display_name?: string; title?: string };
    return Response.json(
      await coreFetch(`/v1/directory/${id}`, { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** True delete via db/0076's definer door — admin/owner only (the SQL is
    the wall; core's requireAdmin refuses earlier and more politely). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await coreFetch(`/v1/directory/${id}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
