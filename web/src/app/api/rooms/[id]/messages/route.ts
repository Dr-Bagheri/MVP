import { coreStream, errorResponse } from "@/server/core";

/**
 * A room answers with SEVERAL turns over tens of seconds — a full round of
 * agents, each one a model call with tools. Vercel kills a function at its
 * plan's default duration (~10s on the deployed tier), which would cut the
 * stream in the middle of the second speaker; 300 asks for the plan maximum
 * and Vercel clamps to what the tier allows. Same number and same reason as
 * the assistant's ask, which is the route this one is modelled on.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:id/messages → SSE passthrough (db/0164).
 *
 * Nothing is buffered here — buffering an event stream defeats the point,
 * and the point on THIS surface is that the person watches the agents take
 * turns. The events are core's own room vocabulary (`message`, `working`,
 * `turn_failed`, `bounded`, `done`), forwarded byte for byte: this hop
 * attaches the session and translates nothing.
 *
 * Everything that can refuse still refuses BEFORE the headers go out —
 * core writes the person's turn first, so a bad room id is a real 404 with a
 * JSON body rather than an error frame every client would have to special-case.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { body?: unknown; locale?: unknown };
    const upstream = await coreStream(
      `/v1/rooms/${encodeURIComponent(id)}/messages`,
      { body: body.body, locale: body.locale },
    );
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
