import { coreFetch, errorResponse } from "@/server/core";
import type { SummaryVersion } from "@/api/types";

/**
 * All versions, NEWEST FIRST. Regenerating adds a version and moves the
 * pointer — it never destroys the previous one (SPEC) — so this list is
 * append-only in practice and each entry carries the model that produced it
 * (the provenance invariant).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(
      await coreFetch<{ summaries: SummaryVersion[] }>(`/v1/calls/${id}/summaries`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
