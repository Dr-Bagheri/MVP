import { coreFetch, errorResponse } from "@/server/core";
import type { Speaker } from "@/api/types";

/**
 * core/ answers `{call_id, speakers}`, not a bare array — the second route
 * found declaring the wrong shape for someone else's response (the calls list
 * was the first). Unwrapped here so the client's `Speaker[]` contract is true.
 * Left as it was, the roster would arrive as an object and render as nothing,
 * with the call loading perfectly around the gap.
 *
 * Read-only. Renaming and linking a voice go through `[speakerId]`, the
 * sibling route the client calls; the PATCH that took `speakerId` in the
 * body here had no caller in web/.
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
