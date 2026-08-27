import { coreFetch, errorResponse } from "@/server/core";
import type { Me } from "@/api/types";

/** db/0112 - the person's standing assistant voice. Forwarded verbatim:
    null CLEARS (back to auto), absent leaves alone - the supplied-flag
    contract must survive this hop untouched. */
export async function PATCH(request: Request) {
  try {
    return Response.json(
      await coreFetch<Me>("/v1/me/assistant", {
        method: "PATCH",
        body: await request.json(),
      }));
  } catch (error) {
    return errorResponse(error);
  }
}
