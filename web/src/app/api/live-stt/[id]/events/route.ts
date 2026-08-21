import { coreFetch, errorResponse } from "@/server/core";

/** M38: the caption stream — SSE passthrough, nothing buffered. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const upstream = await coreFetch<Response>(`/v1/live-stt/${encodeURIComponent(id)}/events`, {
      headers: { accept: "text/event-stream" },
      raw: true,
    });
    return new Response(upstream.body, {
      status: 200,
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
