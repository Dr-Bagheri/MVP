import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/[id]/finish — recording is over, the pipeline owns the
 * call now (`recording` → `processing`). Finishing twice returns the same
 * answer; core treats it as an idempotent read, not a fault.
 *
 * M40: an optional `provisional_transcript` (the live-caption text) rides
 * the body — the instant preview shown while the pipeline runs. Forwarded
 * verbatim; core bounds and gates it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { provisional_transcript?: string } | undefined;
  try {
    const parsed = (await request.json()) as { provisional_transcript?: unknown };
    if (typeof parsed?.provisional_transcript === "string") {
      body = { provisional_transcript: parsed.provisional_transcript };
    }
  } catch {
    /* no body — the historical shape, still the common one */
  }
  try {
    return Response.json(
      await coreFetch(`/v1/calls/${id}/finish`, { method: "POST", ...(body ? { body } : {}) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
