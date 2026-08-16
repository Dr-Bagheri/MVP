import { coreStream, errorResponse } from "@/server/core";

/**
 * Regenerate (M27): re-answer the session's standing question as a fresh
 * run, optionally on a different model. SSE passthrough like ask — nothing
 * buffered, the events ARE the product.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = (await request.json()) as { model?: string };
  try {
    const upstream = await coreStream(`/v1/assistant/sessions/${sessionId}/regenerate`, {
      model: body.model,
    });
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
