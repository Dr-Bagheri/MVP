import { coreFetch, errorResponse } from "@/server/core";
import type { ModelsResponse } from "@/api/types";

/**
 * The catalogue available to the caller — already intersected with the org
 * allow-list by core/. This layer filters NOTHING.
 *
 * It used to claim otherwise: the comment here said "tool-capable only" and
 * the screens filtered on an invented `tool_capable` field. `/v1/models`
 * returns `tool_capability_filtered: false` precisely so a consumer cannot
 * keep asserting a guarantee nobody implements. Read that flag; never
 * substitute a heuristic for it.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<ModelsResponse>("/v1/models"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The caller's own preference (M5 — per user, not per org).
 *
 * `null` is a legitimate value meaning "no choice", and it must survive the
 * hop as null rather than being coerced into a default here.
 */
export async function PUT(request: Request) {
  const { model } = (await request.json()) as { model: string | null };
  try {
    return Response.json(
      await coreFetch<{ preferred_model: string | null }>("/v1/models/preferred", {
        method: "PUT",
        body: { model },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
