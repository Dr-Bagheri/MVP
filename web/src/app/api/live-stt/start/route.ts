import { coreFetch, errorResponse } from "@/server/core";

/**
 * M38: open a live-transcription relay session. The response carries the
 * session TICKET and — when CORE_PUBLIC_URL is configured — the public
 * core base, so the browser streams audio/captions DIRECTLY to core: the
 * per-chunk serverless hop cost seconds of transcript lag (user report,
 * 2026-08-21: ~10s turn-around). Without the env, everything still rides
 * the BFF paths.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { format?: string };
    const started = await coreFetch<{ session_id: string; ticket: string }>(
      "/v1/live-stt/start", {
        method: "POST",
        body: body.format === "pcm16k" ? { format: "pcm16k" } : {},
      });
    return Response.json({
      ...started,
      direct_url: process.env.CORE_PUBLIC_URL ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
