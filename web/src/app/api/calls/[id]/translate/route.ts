import { coreFetch, errorResponse, readJson } from "@/server/core";

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
    const body = (await readJson(request)) as { what?: string; model?: string; target?: string };
    /* the transcript's translation is a JOB since 2026-09-06 (C4): core
       answers 202 with the request's status and the page polls
       GET …/translation; the summary path still answers the text */
    return Response.json(
      await coreFetch(`/v1/calls/${id}/translate`, {
        method: "POST",
        body: { what: body.what, model: body.model, target: body.target },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
