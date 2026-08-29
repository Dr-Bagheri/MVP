import { coreFetch, errorResponse } from "@/server/core";
import type { OrgSessionRow } from "@/api/types";

/**
 * db/0135 — every LIVE session in the caller's org, for an admin or owner.
 *
 * The sibling route at `/api/me/sessions` attaches a LOCATION to the current
 * row from Vercel's geo headers. This one deliberately attaches nothing.
 * Those headers describe where THIS request came from — the admin's own
 * browser — and stamping that onto a list of colleagues' sessions would
 * label every row with the reader's city. The one thing this hop knows is
 * the one thing that is not true of the rows it is serving.
 *
 * No role check here: core refuses a non-admin, and the database refuses it
 * again underneath. A third copy in the BFF would be a rule that can drift
 * from the two that matter.
 */
export async function GET() {
  try {
    const answer = await coreFetch<{ sessions: OrgSessionRow[] }>("/v1/admin/sessions");
    return Response.json(answer);
  } catch (error) {
    return errorResponse(error);
  }
}
