import { coreFetch, errorResponse } from "@/server/core";

/** The caller's own verdicts for one thread, keyed by message id (M27). */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    return Response.json(
      await coreFetch<{ feedback: Record<string, string> }>(
        `/v1/assistant/sessions/${sessionId}/feedback`,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
