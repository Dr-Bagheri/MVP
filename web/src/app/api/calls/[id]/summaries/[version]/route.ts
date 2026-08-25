import { coreFetch, errorResponse } from "@/server/core";

/**
 * Delete ONE summary version (db/0095's door: owner or admin). 204 on
 * success; the door's refusals arrive as legible 403/404s.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const { id, version } = await params;
  try {
    // `raw`: core answers 204 with an empty body — `.json()` would crash
    // on the SUCCESS path only
    await coreFetch<Response>(
      `/v1/calls/${encodeURIComponent(id)}/summaries/${encodeURIComponent(version)}`,
      { method: "DELETE", raw: true },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
