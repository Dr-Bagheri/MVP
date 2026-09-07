import { coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * THE SHARED WHITEBOARD (db/0206).
 *
 * `?since=` is forwarded rather than answered here: core replies 204 when the
 * version has not moved, and a BFF that decided that for itself would be a
 * second place holding an opinion about whether the board has changed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = new URL(request.url).searchParams.get("since");
  try {
    const board = await coreFetch<{ shapes: unknown[]; version: number } | null>(
      `/v1/meetings/${encodeURIComponent(id)}/board${since === null ? "" : `?since=${encodeURIComponent(since)}`}`,
    );
    /* core's 204 arrives here as null — the honest relay is 204 again, so the
       client can tell "unchanged" from "an empty board" */
    if (board === null) return new Response(null, { status: 204 });
    return Response.json(board);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/board`,
      { method: "PUT", body: await readJson(request) },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
