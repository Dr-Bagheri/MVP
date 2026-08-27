import { coreFetch, errorResponse } from "@/server/core";

/** M41 - the RUNNABLE catalogue: published+enabled engine workflows. */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ workflows: { id: string; handle: string; name: string; description: string }[] }>(
        "/v1/workflows/engine"));
  } catch (error) {
    return errorResponse(error);
  }
}
