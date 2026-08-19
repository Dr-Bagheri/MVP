import { coreFetch, errorResponse } from "@/server/core";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/organizations/${orgId}`, {
      method: "PATCH", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
