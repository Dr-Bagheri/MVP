import { coreFetch, errorResponse } from "@/server/core";
import type { TranscriptRow } from "@/api/types";

/** Rows carry their own timing; M20's ladder is decided client-side from it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<TranscriptRow[]>(`/v1/calls/${id}/transcript`));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Line correction. A corrected line KEEPS its identity and is marked edited
 * (SPEC) — so this is a PATCH of one row, never a replace of the transcript.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rowId, text } = (await request.json()) as { rowId: string; text: string };
  try {
    return Response.json(
      await coreFetch(`/v1/calls/${id}/transcript/${rowId}`, {
        method: "PATCH",
        body: { text },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
