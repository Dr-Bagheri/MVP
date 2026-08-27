import { coreFetch, errorResponse } from "@/server/core";

/** M41 P1 — the manual trigger. Identity forwarded; core decides. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    const { ref } = await params;
    return Response.json(
      await coreFetch<{ run_id: string; status: string }>(
        `/v1/workflows/${encodeURIComponent(ref)}/run`,
        { method: "POST", body: {} },
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
