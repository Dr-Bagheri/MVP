import { CORE_URL, coreFetch, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * Voice enrollment (M39): the clip's bytes go straight through to core —
 * BINARY, so the POST talks to core directly instead of the JSON-shaped
 * coreFetch (the live-stt audio route's pattern). The clip is content: it
 * is never logged, never buffered beyond the hop, and core keeps only the
 * VECTOR, not the audio.
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
    const upstream = await fetch(
      `${CORE_URL}/v1/directory/${encodeURIComponent(id)}/voice`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": request.headers.get("content-type") ?? "application/octet-stream",
        },
        body: await request.arrayBuffer(),
        cache: "no-store",
      },
    );
    return Response.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await coreFetch<null>(`/v1/directory/${encodeURIComponent(id)}/voice`, {
      method: "DELETE",
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
