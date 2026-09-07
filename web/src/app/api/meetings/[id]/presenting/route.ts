import { coreFetch, errorResponse, readJson } from "@/server/core";

/** 0206 — the document the host is showing; the body's `attachment_id` may be null. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/presenting`,
      { method: "PUT", body: await readJson(request) },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
