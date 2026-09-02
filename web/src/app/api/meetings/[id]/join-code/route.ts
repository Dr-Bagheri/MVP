import { coreFetch, errorResponse } from "@/server/core";

/** Mint or revoke a meeting's guest code. Core checks the meeting. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch<{ join_code: string | null }>(
      `/v1/meetings/${encodeURIComponent(id)}/join-code`,
      { method: "PUT", body: await request.json() },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
