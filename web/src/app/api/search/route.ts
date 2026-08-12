import { coreFetch, errorResponse } from "@/server/core";
import type { SearchHit } from "@/api/types";

/**
 * One box over transcripts and summaries. Scope filtering is RLS's, not
 * ours — and per M8 core/ returns offsets rather than bulk content, so the
 * agent (or the user) expands only the windows actually wanted.
 */
export async function POST(request: Request) {
  const { query } = (await request.json()) as { query: string };
  try {
    return Response.json(
      await coreFetch<SearchHit[]>("/v1/search", { method: "POST", body: { query } }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
