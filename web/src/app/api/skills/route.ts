import { coreFetch, errorResponse } from "@/server/core";
import type { Skill } from "@/api/types";

/**
 * Three levels resolved server-side (system / org / user, most specific
 * wins). Skills are DATA, so this is a plain read — no model involved.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<Skill[]>("/v1/skills"));
  } catch (error) {
    return errorResponse(error);
  }
}
