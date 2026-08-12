import { coreFetch, errorResponse } from "@/server/core";
import type { SummaryVersion } from "@/api/types";

/**
 * All versions, newest last. Replacing a summary ADDS a version and moves the
 * pointer — versions survive (SPEC), so this list is append-only in practice
 * and each entry carries the model that produced it (provenance invariant).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<SummaryVersion[]>(`/v1/calls/${id}/summaries`));
  } catch (error) {
    return errorResponse(error);
  }
}
