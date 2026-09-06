import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/users/${userId}`, {
      method: "PATCH", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/users/${userId}`, {
      method: "DELETE", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
