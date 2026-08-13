import { coreFetch, errorResponse } from "@/server/core";

/**
 * Archive / unarchive. core/ exposes these as two verbs
 * (`POST /v1/calls/:id/archive` and `/unarchive`) rather than a PATCH of a
 * flag, which matches the wire shape: `archived_at` is a TIMESTAMP, so the
 * server records *when* rather than being told *whether*.
 *
 * NOT the delete family. Soft delete is currently broken for the owner of a
 * call — a row policy makes the row invisible to its own owner the instant
 * it is marked deleted, so Postgres refuses the write and the caller gets a
 * 404 while the call stays in their list. It succeeds for admins. That fix
 * lives in db/ and is with Backend 3; `deleteCall`/`restoreCall` stay on
 * fixtures until it lands (see client.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { archived } = (await request.json()) as { archived: boolean };
  try {
    return Response.json(
      await coreFetch(`/v1/calls/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
