import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/organizations/${orgId}`, {
      method: "PATCH", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/organizations/${orgId}`, {
      method: "DELETE", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
