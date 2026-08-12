import { coreFetch, errorResponse } from "@/server/core";
import type { Call, CallScope } from "@/api/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<Call>(`/v1/calls/${id}`));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Scope switch and archive flag — plain-code paths, no model involved. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = (await request.json()) as { scope?: CallScope; archived?: boolean };
  try {
    return Response.json(
      await coreFetch<Call>(`/v1/calls/${id}`, { method: "PATCH", body: patch }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Soft delete (M11): 30-day purge window, admins may delete any call in the
 * org, members only their own — enforced in core/, asserted by SQL tests.
 * The agent has no path here at all (its DB role has no DELETE).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await coreFetch(`/v1/calls/${id}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
