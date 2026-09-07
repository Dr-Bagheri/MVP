import { coreFetch, errorResponse } from "@/server/core";

/**
 * A short-lived signed URL for one of the meeting's documents. The URL is a
 * CREDENTIAL for those bytes, so it is minted per read and never stored.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/url`,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
