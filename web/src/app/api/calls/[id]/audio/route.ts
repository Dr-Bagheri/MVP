import { coreFetch, errorResponse } from "@/server/core";

/**
 * GET /api/calls/[id]/audio — signed, expiring playback URLs for every part
 * of a call the caller may see. The URLs point the browser STRAIGHT at
 * storage (the same no-proxy reasoning as uploads); this hop carries
 * identity and the tiny envelope only. A 404 covers "no such call", "not
 * yours" and "no audio yet" identically, by core's design.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/calls/${id}/audio`));
  } catch (error) {
    return errorResponse(error);
  }
}
