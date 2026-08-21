import { coreStream, errorResponse } from "@/server/core";

/**
 * Vercel kills a function at its plan's default duration — ~10s on the
 * deployed tier — and an agent run with tools routinely outlives that. The
 * stream then dies mid-answer and the client honestly reports "connection
 * dropped" (user report, 2026-08-17: every tool-using ask on production).
 * 300 asks for the plan maximum; Vercel clamps to what the tier allows.
 */
export const maxDuration = 300;

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
    call_ids?: string[];
    web?: boolean;
    agent?: string;
    workflow?: string;
    connector_provider?: "google" | "microsoft";
    source_id?: string;
    locale?: string;
    /* M33/M34 — the fields THIS route dropped for a day while both ends
       were correct (user report, 2026-08-21: "I don't have the ability to
       navigate" — core never saw the tools this surface advertised). The
       comment above about two hand-written beliefs described this exact
       failure, and the route still reproduced it when the wire grew. */
    client_tools?: string[];
    context?: { route?: string; entity?: { kind?: string; id?: string } };
  };

  try {
    const upstream = await coreStream("/v1/assistant/ask", {
      question: body.question,
      session_id: body.session_id,
      model: body.model,
      skill: body.skill,
      call_id: body.call_id,
      call_ids: body.call_ids,
      web: body.web,
      agent: body.agent,
      workflow: body.workflow,
      connector_provider: body.connector_provider,
      source_id: body.source_id,
      locale: body.locale,
      client_tools: body.client_tools,
      context: body.context,
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
