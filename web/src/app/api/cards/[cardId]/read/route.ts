import { coreFetch, errorResponse } from "@/server/core";

export async function POST(_request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  try {
    return Response.json(await coreFetch(`/v1/cards/${cardId}/read`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
