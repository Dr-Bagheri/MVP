import { coreFetch, errorResponse } from "@/server/core";
import type { AuthoredSkill } from "@/api/types";

/**
 * The editor's list (M29): full definitions, prompt included, filtered to
 * rows the CALLER may edit — admins get the org's, everyone their own.
 * Deliberately not the resolved picker view: an author needs disabled,
 * shadowed and archived rows, which the resolver exists to collapse.
 */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ skills: AuthoredSkill[]; available_tools: string[] }>("/v1/skills/manage"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
