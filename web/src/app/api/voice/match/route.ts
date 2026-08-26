import { CORE_URL, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * Live voice match (2026-08-26): the snippet's bytes go straight through
 * to core — BINARY, like the enrollment clip, so it bypasses the
 * JSON-shaped coreFetch. The audio is content: never logged, never
 * buffered beyond the hop, and core stores none of it.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return Response.json({ error: "no session" }, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/voice/match`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": request.headers.get("content-type") ?? "application/octet-stream",
      },
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
