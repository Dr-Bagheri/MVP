import { coreFetch, errorResponse } from "@/server/core";

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/roots/${userId}`, {
      method: "DELETE", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
