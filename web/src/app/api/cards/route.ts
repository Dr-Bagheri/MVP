import { coreFetch, errorResponse } from "@/server/core";

/** M35: the proactivity channel — the owner's agent-initiated cards. */
export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/cards"));
  } catch (error) {
    return errorResponse(error);
  }
}
