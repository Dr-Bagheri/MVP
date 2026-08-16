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
  /*
   * Translated to CORE's contract, field for field. The first version of
   * this route forwarded the fixture-era shape ({page, callIds, modelId})
   * that core never read — two hand-written beliefs about one wire, and
   * `session_id` simply never travelled, which is the every-message-starts-
   * a-new-conversation bug wearing a working demo's clothes (rule 10).
   */
  const body = (await request.json()) as {
    question?: string;
    session_id?: string;
    model?: string;
    skill?: string;
    call_id?: string;
  };

  try {
    const upstream = await coreStream("/v1/assistant/ask", {
      question: body.question,
      session_id: body.session_id,
      model: body.model,
      skill: body.skill,
      call_id: body.call_id,
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
