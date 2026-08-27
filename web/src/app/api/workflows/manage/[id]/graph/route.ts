import { coreFetch, errorResponse } from "@/server/core";

/** M41 P5 — the editor loads the current program (admin policy read). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ graph: unknown; max_autonomy: string; budget: unknown }>(
        `/v1/workflows/manage/${encodeURIComponent(id)}/graph`));
  } catch (error) {
    return errorResponse(error);
  }
}
