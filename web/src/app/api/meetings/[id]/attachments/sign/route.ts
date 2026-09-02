import { coreFetch, errorResponse } from "@/server/core";

/** A one-shot upload URL. The bytes go browser → Storage, never through us. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<{ path: string; url: string; token: string }>(
      `/v1/meetings/${encodeURIComponent(id)}/attachments/sign`,
      { method: "POST", body: await request.json() },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
