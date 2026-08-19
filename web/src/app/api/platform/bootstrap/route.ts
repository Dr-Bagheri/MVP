import { coreFetch, errorResponse } from "@/server/core";

/** The root email is deployment-only; this endpoint accepts no target or secret. */
export async function POST() {
  try {
    return Response.json(await coreFetch<{ claimed: boolean }>("/v1/platform/bootstrap", { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
