import { coreFetch, errorResponse } from "@/server/core";

/** A whole-transcript translation is one long model call — same reasoning
 *  as the ask route: the platform default duration kills it mid-run. */
export const maxDuration = 300;

/**
 * POST /api/calls/[id]/translate — {what: "summary"|"transcript", model?}.
 * Core runs the /translator system skill (0063) and returns the English
 * text; the run lands in agent_run like every other model call. Nothing is
 * persisted — the Persian transcript stays the single source of truth.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { what?: string; model?: string };
    return Response.json(
      await coreFetch(`/v1/calls/${id}/translate`, {
        method: "POST",
        body: { what: body.what, model: body.model },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
