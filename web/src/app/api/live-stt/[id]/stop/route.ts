import { coreFetch, errorResponse } from "@/server/core";

/** M38: end the relay session — the provider flushes its final captions. */
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return Response.json(
      await coreFetch(`/v1/live-stt/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
