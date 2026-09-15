import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/:id/decisions — re-run the DECISION EXTRACTION over this
 * record's transcript (the Summary tab's «تولید دوباره»).
 *
 * One model pass, not a regenerated summary, and it answers with a count: the
 * shape of the reply is core's to decide, forwarded whole rather than narrowed
 * here — the three nothings it distinguishes (`reason`) are the kind of thing
 * a BFF flattens by accident.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch(`/v1/calls/${encodeURIComponent(id)}/decisions`, { method: "POST" }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
