import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  try {
    await coreFetch<null>(
      `/v1/meetings/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: await request.json() },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  try {
    await coreFetch<null>(
      `/v1/meetings/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
