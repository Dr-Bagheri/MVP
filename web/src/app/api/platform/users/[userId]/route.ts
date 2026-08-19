import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/users/${userId}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
