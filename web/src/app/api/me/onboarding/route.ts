import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { Me } from "@/api/types";

/**
 * The first-time flow's save (db/0223, M54): `{ answers?, complete? }`.
 *
 * The allow-list is written out, matching core's — core answers an unknown
 * key with `400 unknown_fields`, so a typo here surfaces as a refusal that
 * names the field instead of a save that quietly drops it. Nothing is
 * defaulted: an absent `complete` leaves the stamp alone, which is what lets
 * every step save its answers without ending the flow.
 */
export async function PATCH(request: Request) {
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ("answers" in body) patch.answers = body.answers;
    if ("complete" in body) patch.complete = body.complete;
    return Response.json(await coreFetch<Me>("/v1/me/onboarding", { method: "PATCH", body: patch }));
  } catch (error) {
    return errorResponse(error);
  }
}
