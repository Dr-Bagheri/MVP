import { coreFetch, errorResponse } from "@/server/core";
import type { ModelInfo } from "@/api/types";

/**
 * The live catalogue, already intersected with the org allow-list by core/
 * (M5). The client filters nothing security-relevant: it only hides
 * non-tool-capable entries from the picker, which is a usability rule, not
 * the wall.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<ModelInfo[]>("/v1/models"));
  } catch (error) {
    return errorResponse(error);
  }
}
