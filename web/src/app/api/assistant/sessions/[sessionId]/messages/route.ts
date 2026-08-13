import { coreFetch, errorResponse } from "@/server/core";
import type { AgentMessage } from "@/api/types";

/**
 * Reading a past conversation — **a read of what was said, never a replay.**
 *
 * The distinction is the whole design. Resuming does not re-run anything: no
 * tool executes twice, no proposal is re-offered, nothing is charged again. It
 * returns the turns that were persisted, and a turn is written only on
 * delivery — which is why a failed run leaves its question standing alone with
 * no assistant reply after it, and why nothing here carries `failed: true`.
 * That flag belongs to the LIVE stream, where the client watched the failure
 * happen; manufacturing it on a read would invent an event the server has no
 * record of.
 *
 * A 404 means the conversation is not the caller's or does not exist —
 * deliberately the same answer, so that ids cannot be probed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  try {
    return Response.json(
      await coreFetch<{ messages: AgentMessage[] }>(
        `/v1/assistant/sessions/${sessionId}/messages`,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
