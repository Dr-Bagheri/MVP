import { coreFetch, errorResponse } from "@/server/core";

/**
 * A HUMAN's transcript correction (0092): the line keeps its identity,
 * words are cleared (the timing flag demotes by design), the edit is
 * stamped. Authority is the database door's.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; segmentId: string }> },
) {
  const { id, segmentId } = await params;
  try {
    const body = (await request.json()) as { text?: string };
    return Response.json(
      await coreFetch<{ ok: boolean }>(
        `/v1/calls/${encodeURIComponent(id)}/segments/${encodeURIComponent(segmentId)}`,
        { method: "PATCH", body: { text: body.text } },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
