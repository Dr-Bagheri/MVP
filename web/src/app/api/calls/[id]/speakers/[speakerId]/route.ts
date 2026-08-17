import { coreFetch, errorResponse } from "@/server/core";

/**
 * PATCH a call's speaker: rename the label («S1» → whatever reads better)
 * and/or link a directory person (`person_id: null` unlinks — undefined
 * leaves alone; the BFF forwards the distinction untouched).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; speakerId: string }> },
) {
  const { id, speakerId } = await params;
  try {
    const body = (await request.json()) as { person_id?: string | null; label?: string };
    return Response.json(
      await coreFetch(`/v1/calls/${id}/speakers/${speakerId}`, { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
