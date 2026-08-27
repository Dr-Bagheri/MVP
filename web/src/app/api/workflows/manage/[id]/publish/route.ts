import { coreFetch, errorResponse } from "@/server/core";

/** M41 P5 — validate-then-insert version N+1. Refusals name step + rule. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ version: number; version_id: string }>(
        `/v1/workflows/manage/${encodeURIComponent(id)}/publish`,
        { method: "PUT", body: await request.json() },
      ), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
