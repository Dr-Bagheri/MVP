import { coreFetch, errorResponse } from "@/server/core";
import type { Role, User, UserStatus } from "@/api/types";

/** Members + the pending-approval queue (M15). Admin-only in core/. */
export async function GET() {
  try {
    return Response.json(await coreFetch<User[]>("/v1/admin/members"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Accept / reject / disable, and role assignment. Accepting is what turns a
 * pending account into a usable one — nothing is visible before it (M15).
 */
export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    userId: string;
    status?: UserStatus;
    role?: Role;
  };
  try {
    return Response.json(
      await coreFetch<User[]>(`/v1/admin/members/${body.userId}`, {
        method: "PATCH",
        body: { status: body.status, role: body.role },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
