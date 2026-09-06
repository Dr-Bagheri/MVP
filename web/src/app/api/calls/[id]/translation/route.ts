import { coreFetch, errorResponse } from "@/server/core";
import type { CallTranslation } from "@/api/types";

/**
 * GET /api/calls/[id]/translation?language=en — the transcript's translation
 * as the transcriber prepared it (2026-09-06, C4): its status (`none`,
 * `queued`, `ready`, `failed`) and, when ready, one translated text per
 * segment id. The page polls this after POST …/translate answers `queued`.
 * A call the caller cannot see is 404 from core, passed through untouched.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const language = new URL(request.url).searchParams.get("language") ?? "en";
  try {
    return Response.json(await coreFetch<CallTranslation>(
      `/v1/calls/${id}/translation?language=${encodeURIComponent(language)}`,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
