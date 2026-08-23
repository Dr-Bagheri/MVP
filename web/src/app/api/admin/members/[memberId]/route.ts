import { coreFetch, errorResponse } from "@/server/core";
import type { Role, User, UserStatus } from "@/api/types";

/**
 * Accept a pending member. **Deliberately separate from PATCH**: activation
 * is not just another field edit, and keeping it on its own path means a
 * pending account cannot be switched on through a general-purpose update.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  try {
    return Response.json(
      await coreFetch<User>(`/v1/admin/members/${memberId}/accept`, { method: "POST" }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Role and status changes for an already-decided member.
 *
 * Two refusals come back from core/ and both are correct, not bugs to work
 * around: `status` cannot be set back to `pending` (accept is one-way), and
 * an admin cannot demote or disable THEMSELVES — a 409, because nothing below
 * the app layer stops an org being stranded with no admin at all.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const body = (await request.json()) as {
    role?: Role; status?: UserStatus;
    /* admin renames (0064-era): forwarded verbatim; core owns every rule */
    display_name?: string; username?: string | null;
  };
  try {
    return Response.json(
      await coreFetch<User>(`/v1/admin/members/${memberId}`, { method: "PATCH", body }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * True delete — core's owner-only tombstone (M24). On this screen it is the
 * "reject" for a pending registration, because a pending member cannot be
 * PATCHed at all: acceptance is one-way on its own path, and there is no
 * softer refuse-registration operation on the wire.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    // `raw`: core answers 204 with an empty body, which `.json()` would
    // turn into a crash on the SUCCESS path only
    await coreFetch<Response>(`/v1/admin/members/${memberId}`, { method: "DELETE", body: { reason: body.reason }, raw: true });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
