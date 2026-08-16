import { coreFetch, errorResponse } from "@/server/core";
import type { AgentMessage } from "@/api/types";

/**
 * A colleague's SHARED conversation, read-only, through db/0058's doors.
 * One nothing on refusal (no share / other org / revoked) — none of them
 * probeable from this side either.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    return Response.json(
      await coreFetch<{ session: { id: string; title: string }; messages: AgentMessage[] }>(
        `/v1/assistant/shared/${sessionId}`,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
