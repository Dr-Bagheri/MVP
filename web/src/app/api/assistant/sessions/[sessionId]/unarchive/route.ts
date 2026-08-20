import { coreFetch, errorResponse } from "@/server/core";

/** The reverse hop, created with its sibling so undo is never route-less. */
export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    return Response.json(await coreFetch(`/v1/assistant/sessions/${sessionId}/unarchive`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
