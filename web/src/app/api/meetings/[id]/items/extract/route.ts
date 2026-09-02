import { coreFetch, errorResponse } from "@/server/core";

export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(
      `/v1/meetings/${encodeURIComponent(id)}/items/extract`, { method: "POST" },
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
