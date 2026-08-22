import { coreFetch, errorResponse } from "@/server/core";

/** POST /api/calls/:id/retry — resume a FAILED call's pipeline. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ id: string; status: string; resumed_at: string; parts: number }>(
        `/v1/calls/${encodeURIComponent(id)}/retry`,
        { method: "POST", body: {} },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
