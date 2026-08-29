import { coreFetch, errorResponse } from "@/server/core";

/**
 * db/0137 — an admin sets a member's password.
 *
 * The password crosses this hop in a body and is forwarded once. It is never
 * logged, and never placed in a path or query string — those reach access
 * logs, proxies and browser history, which is where a secret goes to survive
 * the request that carried it. Nothing about it comes back: the response
 * carries only how many sessions the reset ended.
 *
 * No role check here. Core refuses a non-admin and the rank rule lives in
 * the database underneath it; a third copy in the BFF would be the one that
 * drifts.
 *
 * The folder is `[memberId]`, not `[id]`, and that is not cosmetic: Next
 * refuses two different slug NAMES at the same path depth, and the sibling
 * route here already owns `[memberId]`. The first version used `[id]` and
 * took the whole dev server down — every route 404'd, including ones nowhere
 * near this one. Neither the 710-test suite nor the production build gate
 * caught it; the browser did, on the first page load.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) {
  try {
    const { memberId } = await context.params;
    const body = (await request.json()) as { password?: string };
    const result = await coreFetch<{ sessions_ended: number }>(
      `/v1/admin/members/${encodeURIComponent(memberId)}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: body.password ?? "" }),
      },
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
