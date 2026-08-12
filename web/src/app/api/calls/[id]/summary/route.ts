import { coreFetch, errorResponse } from "@/server/core";
import type { SummaryVersion } from "@/api/types";

/**
 * The CURRENT version only.
 *
 * 404 here means "this call has no summary" — the call itself is visible.
 * That is a different fact from the 404 on an invisible call, and callers
 * must not collapse them: one is "nothing to show yet", the other is "not
 * yours". Both arrive as 404 by design (an invisible call must not be
 * distinguishable from a missing one), so the caller's context — did the
 * call object itself load? — is what separates them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<SummaryVersion>(`/v1/calls/${id}/summary`));
  } catch (error) {
    return errorResponse(error);
  }
}
