import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/tts → core's /v1/tts (M37) — binary passthrough.
 *
 * The browser sends {text}; core synthesizes with the on-server Persian
 * voice and answers audio/wav. Auth rides the session like every BFF hop;
 * the text is spoken content and is never logged on either side.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { text?: string; lang?: string };
  try {
    const upstream = await coreFetch<Response>("/v1/tts", {
      method: "POST",
      body: { text: body.text, lang: body.lang },
      raw: true,
    });
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "audio/wav", "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
