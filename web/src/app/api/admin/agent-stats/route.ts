import { coreFetch, errorResponse } from "@/server/core";

/** Phase C: org-scoped agent governance aggregates — admin-gated in core. */
export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/admin/agent-stats"));
  } catch (error) {
    return errorResponse(error);
  }
}
