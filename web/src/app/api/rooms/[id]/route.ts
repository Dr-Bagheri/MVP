import { coreFetch, errorResponse } from "@/server/core";
import type { RoomMessageRecord, RoomRecord } from "@/api/types";

/** The room, who is in it, and what was said — one read (db/0164). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ room: RoomRecord; messages: RoomMessageRecord[] }>(
        `/v1/rooms/${encodeURIComponent(id)}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Rename, or file away. The body is forwarded as-is: core refuses an unknown
 * field by NAME rather than ignoring it, and a BFF that filtered the patch
 * here would turn that named refusal into a save that reports success about
 * a field it silently dropped.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<RoomRecord>(`/v1/rooms/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: await request.json(),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
