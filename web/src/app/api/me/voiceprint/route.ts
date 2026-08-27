import { coreFetch, errorResponse } from "@/server/core";

/** db/0112 - withdrawing one's own voice print (consent's other half). */
export async function DELETE() {
  try {
    await coreFetch<null>("/v1/me/voiceprint", { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
