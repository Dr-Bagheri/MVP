import { coreFetch, errorResponse } from "@/server/core";
import type { Invitation, MintedInvitation } from "@/api/types";

/** The org's invitations (admin). Prefixes only — a list can never redeem. */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ invitations: Invitation[] }>("/v1/admin/invitations"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Issue one (D23–D25): show-once token, terms immutable (revoke-and-reissue),
 * the issuer's role bounds what may be granted — all core's rules, all
 * surfaced in core's own words.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; role?: string; ttl_days?: number };
  try {
    return Response.json(
      await coreFetch<MintedInvitation>("/v1/admin/invitations", {
        method: "POST",
        body: { email: body.email, role: body.role, ttl_days: body.ttl_days },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
