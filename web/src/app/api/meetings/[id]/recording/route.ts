import { coreFetch, errorResponse } from "@/server/core";

/**
 * The room's own recording. Core authorises against the MEETING — the caller
 * has to be able to see it — and derives the room name itself, so nothing
 * here decides anything.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<{ egress_id: string }>(
      `/v1/meetings/${encodeURIComponent(id)}/recording`, { method: "POST" },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await coreFetch<null>(`/v1/meetings/${encodeURIComponent(id)}/recording`, {
      method: "DELETE", body: await request.json(),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
