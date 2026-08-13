import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Members, **pending first** — core/ sorts them that way deliberately, so do
 * not re-sort alphabetically here. Burying the approval queue is how someone
 * waits a week to be let in (M15).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = new URLSearchParams();
  /*
   * Forwarded, not applied here. Filtering in the BFF would have the same
   * defect as filtering in the browser once core/ pages: it would search the
   * rows that arrived and report the answer as if it had searched all of
   * them. The server owns the query; this layer owns the hop.
   */
  for (const key of ["search", "status", "role", "sort"]) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";

  try {
    return Response.json(await coreFetch<{ members: User[] }>(`/v1/admin/members${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}
