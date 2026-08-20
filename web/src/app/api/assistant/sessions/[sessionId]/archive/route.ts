import { coreFetch, errorResponse } from "@/server/core";

/**
 * The BFF link that was MISSING: the History page's Delete called
 * `POST /api/assistant/sessions/{id}/archive`, Next.js 404'd, and the
 * `.catch(() => undefined)` beside it swallowed the miss — a button that
 * never did anything and never said so (user report, 2026-08-20). Core's
 * route existed the whole time (`/v1/assistant/sessions/:id/archive`);
 * only this hop was absent — the producer-with-no-consumer seam, one layer
 * up from usual.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    return Response.json(await coreFetch(`/v1/assistant/sessions/${sessionId}/archive`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
