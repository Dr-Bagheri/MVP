import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/[id]/parts/register — the bytes are in storage, make the
 * part REAL: core verifies the object exists under this call's own prefix,
 * writes the `call_part` row and enqueues transcription (M7's contract,
 * ownerId stamped server-side while the caller is present).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { idx: number; offset_ms: number; path: string };
    return Response.json(
      await coreFetch(`/v1/calls/${id}/parts/register`, {
        method: "POST",
        body: { idx: body.idx, offset_ms: body.offset_ms, path: body.path },
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
