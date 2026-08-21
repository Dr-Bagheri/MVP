import { coreFetch, errorResponse } from "@/server/core";

/** M38: open a live-transcription relay session. */
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json(await coreFetch("/v1/live-stt/start", { method: "POST", body: {} }));
  } catch (error) {
    return errorResponse(error);
  }
}
