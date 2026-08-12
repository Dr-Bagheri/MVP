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

/**
 * Line correction. A corrected segment KEEPS its identity and is marked
 * edited (SPEC) — so this is a PATCH of one segment, never a replace of the
 * transcript.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { segmentId, text } = (await request.json()) as { segmentId: string; text: string };
  try {
    return Response.json(
      await coreFetch(`/v1/calls/${id}/transcript/${segmentId}`, {
        method: "PATCH",
        body: { text },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
