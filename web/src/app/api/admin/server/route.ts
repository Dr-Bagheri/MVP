import { coreFetch, errorResponse } from "@/server/core";
import type { ServerHealth } from "@/api/types";

/**
 * Service health (M25, Management · Server) — one hop, nothing reshaped.
 *
 * The body is passed through exactly as core/ built it, and the thing NOT to
 * "helpfully" normalise on the way past is the per-metric `measured_at`:
 * **null there means we did not find out, and a real zero arrives WITH a
 * timestamp.** Defaulting a null metric to `0`, or flattening one unreadable
 * metric into a page-level failure, would each destroy that distinction in a
 * different direction — and this is the surface where it matters, because "0
 * dead letters" reads as healthy and an operator acts on it.
 *
 * core/ answers 200 with per-metric status rather than failing as a unit, so
 * there is deliberately no partial-failure handling here: one unreadable
 * source must not blank three working ones.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<ServerHealth>("/v1/admin/server"));
  } catch (error) {
    return errorResponse(error);
  }
}
