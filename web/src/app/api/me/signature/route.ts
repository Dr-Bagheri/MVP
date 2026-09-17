import { CORE_URL, coreFetch, errorResponse, readJson } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * The caller's own SIGNATURE ON FILE (db/0229).
 *
 * GET is BINARY and talks to core directly — the letterhead's pattern, for
 * the letterhead's reason: the content-type core answers with is the one it
 * SNIFFED from the bytes, and this hop passes it through untouched. It is
 * `no-store` rather than the logo's five minutes: the URL is the same for
 * every person and the picture is not, and a signature is the one image a
 * shared cache must never hand to the next session.
 *
 * PUT and DELETE are JSON through `coreFetch`, like every other write.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/me/signature`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });
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

export async function PUT(request: Request) {
  try {
    const body = await readJson(request);
    return Response.json(await coreFetch("/v1/me/signature", { method: "PUT", body }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    await coreFetch("/v1/me/signature", { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
