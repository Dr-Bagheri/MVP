import { coreFetch, errorResponse } from "@/server/core";
import type { SearchHit } from "@/api/types";

/**
 * One box over transcripts and summaries. Scope filtering is RLS's, not ours,
 * and per M8 core/ returns offsets rather than bulk content.
 *
 * GET, not POST — it is a read with no side effects, and core/ ruled the
 * shape. The query rides as `q`; nothing here is personal data placed in a
 * URL beyond the search term the user just typed into a visible box, and the
 * BFF hop is server-to-server.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const callId = url.searchParams.get("call_id");
  const limit = url.searchParams.get("limit");

  const params = new URLSearchParams({ q });
  if (callId) params.set("call_id", callId);
  if (limit) params.set("limit", limit);

  try {
    // core/ 400s on q shorter than 2 chars; that maps straight through.
    return Response.json(await coreFetch<{ hits: SearchHit[] }>(`/v1/search?${params}`));
  } catch (error) {
    return errorResponse(error);
  }
}
