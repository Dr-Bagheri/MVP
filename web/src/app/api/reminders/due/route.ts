/* 0231 — what should wake the caller now. Polled once a minute while the tab
   is visible; the three windows and the acknowledgement filter are the
   server's, so this hop forwards and nothing else. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/reminders/due"));
  } catch (error) {
    return errorResponse(error);
  }
}
