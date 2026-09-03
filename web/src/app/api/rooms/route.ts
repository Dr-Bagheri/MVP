import { coreFetch, errorResponse } from "@/server/core";
import type { RoomRecord } from "@/api/types";

/**
 * The caller's rooms, and the door to open one (db/0164).
 *
 * `archived` is FORWARDED, never filtered here. Which rooms a caller may see
 * is 0164's read policy, and a BFF that narrowed the set would be an
 * authorization decision taken by the layer holding no authority — the
 * sessions route's own sentence, for the same reason.
 */
export async function GET(request: Request) {
  const archived = new URL(request.url).searchParams.get("archived") === "true";
  try {
    return Response.json(
      await coreFetch<{ rooms: RoomRecord[] }>(`/v1/rooms?archived=${archived}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Open a room. The body is forwarded field for field — core validates the
 * title, resolves every handle through the agent store and refuses the whole
 * statement if one of them is unknown, so a half-open room (one that can
 * never answer) does not exist to be rendered.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: unknown; agents?: unknown };
    return Response.json(
      await coreFetch<RoomRecord>("/v1/rooms", {
        method: "POST",
        body: { title: body.title, agents: body.agents },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
