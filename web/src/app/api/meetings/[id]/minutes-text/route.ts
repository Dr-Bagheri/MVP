import { coreFetch, errorResponse } from "@/server/core";

/** the minutes' prose, composed to the letterhead's clear area (core's
    `/v1/meetings/:id/minutes-text`). It writes nothing — the answer is a
    draft the person reads before it goes into a file. */
export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/minutes-text`, { method: "POST" },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
