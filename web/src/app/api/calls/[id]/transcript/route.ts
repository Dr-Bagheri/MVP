import { coreFetch, errorResponse } from "@/server/core";
import type { TranscriptResponse } from "@/api/types";

/**
 * Segments carry their own timing and their own `words`; M20's ladder is
 * decided per row from that, never from the call-level `transcript_timing`.
 *
 * Windowing (`from_ms`/`to_ms`) selects segments that OVERLAP the window
 * rather than sit strictly inside it, so the utterance straddling a scroll
 * boundary comes back instead of vanishing. Paging is by `from_ms`.
 *
 * A call the caller cannot see is 404 from core/, not an empty list — an
 * empty list would assert "this call exists and has no words". We pass that
 * distinction through untouched.
 *
 * Read-only. A line correction goes through `segments/[segmentId]` (0092);
 * the PATCH that lived here targeted `/v1/calls/:id/transcript/:segmentId`,
 * a path core never registered, and nothing in web/ ever called it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["from_ms", "to_ms", "limit"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";

  try {
    return Response.json(await coreFetch<TranscriptResponse>(`/v1/calls/${id}/transcript${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}
