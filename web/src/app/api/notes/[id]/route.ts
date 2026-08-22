import { coreFetch, errorResponse } from "@/server/core";

/** DELETE /api/notes/:id — the author removes their own note (0079). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await coreFetch<null>(`/v1/notes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
