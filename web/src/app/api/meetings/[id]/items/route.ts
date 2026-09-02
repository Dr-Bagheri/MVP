import { coreFetch, errorResponse } from "@/server/core";

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/items`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/items`, {
      method: "POST", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
