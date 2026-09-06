import { coreFetch, errorResponse } from "@/server/core";
import type { AssistantSession } from "@/api/types";

/**
 * The conversation list — what the hub resumes FROM (M4/db-0018).
 *
 * This route did not exist. `api.agentSessions()` was written, the client
 * consumed it, the hub rendered a resume list from it, and core/'s
 * `GET /v1/assistant/sessions` was live and proven the whole time — the two
 * halves simply had nothing between them. A missing BFF route is the quietest
 * kind of gap: the screen works, because the fixtures answer.
 *
 * `archived` is forwarded rather than filtered here. Q5 archives conversations
 * and never deletes them, so "archived" is a real view and not a tidy-up — and
 * core/ owns which rows a caller may see. Deciding that in this layer would be
 * an authorization decision taken by the component that holds no authority.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams({ archived: String(incoming.get("archived") === "true") });
  /* `limit` and `before` are the bounded list's door out of its first page
     (core pages by keyset) — forwarded when present, interpreted by core alone */
  for (const key of ["limit", "before"]) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  try {
    return Response.json(
      await coreFetch<{ sessions: AssistantSession[] }>(
        `/v1/assistant/sessions?${query}`,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
