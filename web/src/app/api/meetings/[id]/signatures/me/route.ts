import { coreFetch, errorResponse } from "@/server/core";

/** taking your own signature back off a meeting (db/0229) — never a
    colleague's, which core's policy keeps true whatever this route is sent */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/signatures/me`, { method: "DELETE" },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
