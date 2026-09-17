import { CORE_URL, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * One placed signature's picture (db/0229) — BINARY, straight from core, the
 * letterhead's pattern: the content-type is the one core sniffed from the
 * bytes. `no-store`, because a signature is the one image no cache may hand
 * to somebody else.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const session = await readSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const upstream = await fetch(
      `${CORE_URL}/v1/meetings/${encodeURIComponent(id)}/signatures/${encodeURIComponent(userId)}/image`,
      { headers: { authorization: `Bearer ${session.accessToken}` }, cache: "no-store" },
    );
    if (!upstream.ok) return new Response(null, { status: upstream.status });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
