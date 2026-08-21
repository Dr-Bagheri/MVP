import { CORE_URL, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * M38: one audio chunk through to the relay — BINARY, so this route talks
 * to core directly instead of through the JSON-shaped coreFetch. The
 * audio is content: it is never logged and never buffered beyond the hop.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await readSession();
  if (!session) return Response.json({ error: "no session" }, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/live-stt/${encodeURIComponent(id)}/audio`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/octet-stream",
      },
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
    return Response.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch (error) {
    return errorResponse(error);
  }
}
