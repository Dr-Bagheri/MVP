import { coreFetch, errorResponse } from "@/server/core";
import type { Speaker } from "@/api/types";

/**
 * core/ answers `{call_id, speakers}`, not a bare array — the second route
 * found declaring the wrong shape for someone else's response (the calls list
 * was the first). Unwrapped here so the client's `Speaker[]` contract is true.
 * Left as it was, the roster would arrive as an object and render as nothing,
 * with the call loading perfectly around the gap.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { speakers } = await coreFetch<{ call_id: string; speakers: Speaker[] }>(
      `/v1/calls/${id}/speakers`,
    );
    return Response.json(speakers);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Rename, or link a voice to a directory person. Linking is the OWNER's
 * deliberate act (M11): voices from private calls never enter the org
 * directory by passive capture, so core/ refuses this for non-owners.
 * A roster edit is a change-list, never a wholesale replacement.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    speakerId: string;
    label?: string;
    personId?: string | null;
  };
  try {
    return Response.json(
      await coreFetch(`/v1/calls/${id}/speakers/${body.speakerId}`, {
        method: "PATCH",
        body: { label: body.label, person_id: body.personId },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
