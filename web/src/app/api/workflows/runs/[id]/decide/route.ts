import { coreFetch, errorResponse } from "@/server/core";

/** M41 P3/W14 — the decision, on the run, by its owner. Forwarded verbatim. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ decision: string; resumed: boolean }>(
        `/v1/workflows/runs/${encodeURIComponent(id)}/decide`,
        { method: "POST", body: await request.json() },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
