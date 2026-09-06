import { coreFetch, errorResponse } from "@/server/core";

/**
 * I AM HERE (db/0202). Stamped when a member on the roster opens a meeting
 * that is being held; core walls it to the caller's own row, so this cannot
 * put anybody else in the room.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await coreFetch<null>(`/v1/meetings/${encodeURIComponent(id)}/attended`, { method: "POST" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
