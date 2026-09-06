import { coreFetch, errorResponse } from "@/server/core";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/attendees/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
