import { coreStream, errorResponse } from "@/server/core";

/**
 * POST /api/assistant/ask → SSE passthrough.
 *
 * The agent runs in core/ as the caller (M4): this handler forwards the
 * question plus page/call context and pipes the event stream straight back,
 * so tool calls appear in the UI as they run. Nothing is buffered here —
 * buffering would defeat the point — and the model choice travels as the
 * user's own selection (M5), never a server default.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question: string;
    page: string;
    callIds: string[];
    modelId: string | null;
  };

  try {
    const upstream = await coreStream("/v1/assistant/ask", body);
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
