import { coreFetch, errorResponse } from "@/server/core";
import type { AuthSessionRow } from "@/api/types";

/** db/0112 - the caller's own devices. */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ sessions: AuthSessionRow[] }>("/v1/me/sessions"));
  } catch (error) {
    return errorResponse(error);
  }
}
