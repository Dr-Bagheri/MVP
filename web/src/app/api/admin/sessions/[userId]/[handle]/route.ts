import { coreFetch, errorResponse } from "@/server/core";

/**
 * db/0135 — end one session belonging to a member the caller outranks.
 *
 * Both identifiers ride in the PATH rather than a body, because this is the
 * shape the resource actually has: a session belongs to a person, and the
 * pair names it. The sibling self-route takes its handle in a body for
 * historical reasons; copying that here would have meant a DELETE whose
 * target is invisible in the request line, including in a log.
 *
 * The rank rule is the database's (`actor_outranks`, 0077) and is not
 * repeated here — a refusal arrives as a 403 and is rendered, never
 * predicted.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string; handle: string }> },
) {
  try {
    const { userId, handle } = await context.params;
    await coreFetch<void>(
      `/v1/admin/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(handle)}`,
      { method: "DELETE" },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
