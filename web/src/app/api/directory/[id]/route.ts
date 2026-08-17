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
