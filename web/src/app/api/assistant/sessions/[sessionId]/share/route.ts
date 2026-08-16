import { coreFetch, errorResponse } from "@/server/core";

/** The owner's share toggle state (M27). */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    return Response.json(
      await coreFetch<{ shared: boolean }>(`/v1/assistant/sessions/${sessionId}/share`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * One POST, both directions — `{shared}` says which. Org-scoped only; there
 * is no public-link branch to route to (invariant 2 refuses that shape).
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = (await request.json()) as { shared?: boolean };
  const path = body.shared
    ? `/v1/assistant/sessions/${sessionId}/share`
    : `/v1/assistant/sessions/${sessionId}/unshare`;
  try {
    return Response.json(await coreFetch<{ shared: boolean }>(path, { method: "POST", body: {} }));
  } catch (error) {
    return errorResponse(error);
  }
}
