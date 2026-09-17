import { CORE_URL, coreFetch, errorResponse, readJson } from "@/server/core";
import { readSession } from "@/server/session";

/**
 * The organisation's LETTERHEAD (db/0228).
 *
 * GET is BINARY and talks to core directly, the logo's pattern and for the
 * logo's reason: the content-type core answers with is the one it SNIFFED
 * from the bytes, and this hop passes it through untouched.
 *
 * The three writes are JSON, so they go through `coreFetch` like every other
 * write on this shelf. The POST carries the page image base64'd WITH the
 * three margins, because a letterhead is one object: a new page under the old
 * clear area is a state the preview the admin just approved never showed
 * them.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const upstream = await fetch(`${CORE_URL}/v1/org/sheet`, {
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
  try {
    const body = await readJson(request);
    return Response.json(await coreFetch("/v1/admin/org/sheet", {
      method: "POST",
      body,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    await coreFetch("/v1/admin/org/sheet", { method: "PATCH", body });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    await coreFetch("/v1/admin/org/sheet", { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
