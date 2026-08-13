import { coreFetch, errorResponse } from "@/server/core";
import type { User } from "@/api/types";

/**
 * Who the caller is. The shell, the profile screen and every admin
 * affordance depend on this.
 *
 * It has to be a round trip: the browser never holds the token (M1), so it
 * cannot read the JWT to find out who it is — and it shouldn't anyway, since
 * core/ resolves `role` from the DATABASE rather than from the token. A token
 * minted a minute ago can be stale about a role that changed since.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<User>("/v1/me"));
  } catch (error) {
    return errorResponse(error);
  }
}
