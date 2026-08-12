import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Members, **pending first** — core/ sorts them that way deliberately, so do
 * not re-sort alphabetically here. Burying the approval queue is how someone
 * waits a week to be let in (M15).
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<{ members: User[] }>("/v1/admin/members"));
  } catch (error) {
    return errorResponse(error);
  }
}
