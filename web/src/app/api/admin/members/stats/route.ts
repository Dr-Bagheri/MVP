import { coreFetch, errorResponse } from "@/server/core";
import type { MemberStats } from "@/api/types";

/**
 * Counts for the stat tiles — an UNFILTERED read, deliberately separate from
 * `GET /v1/admin/members`.
 *
 * Deriving tiles from a filtered member list would make them describe the
 * query rather than the organisation: type a search, watch "total members"
 * fall, and the number is still presented as a fact about the org. That is
 * the same counting lie as client-side filtering, one level up and harder to
 * see, because a wrong total looks exactly like a right one.
 *
 * `trend.history_since === null` travels through untouched: it means the
 * history log was not recording, which the UI renders as "—" rather than "0".
 * A zero from a log that did not exist is a fabricated delta reached by
 * honest arithmetic — the only number on the tile someone would act on.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<MemberStats>("/v1/admin/members/stats"));
  } catch (error) {
    return errorResponse(error);
  }
}
