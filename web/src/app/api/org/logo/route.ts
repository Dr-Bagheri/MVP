import { CORE_URL, errorResponse } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * The org logo: bytes through, both ways.
 *
 * BINARY, so it talks to core directly rather than through the
 * JSON-shaped coreFetch — the enrollment clip's pattern. The content-type
 * core answers with is the one it SNIFFED from the file, never the one an
 * uploader claimed, and this hop passes that through untouched.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/org/logo`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });
    if (!upstream.ok) return new Response(null, { status: upstream.status });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return Response.json({ error: "no session" }, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/admin/org/logo`, {
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

export async function DELETE() {
  const session = await readSession();
  if (!session) return Response.json({ error: "no session" }, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/admin/org/logo`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });
    return new Response(null, { status: upstream.status });
  } catch (error) {
    return errorResponse(error);
  }
}
