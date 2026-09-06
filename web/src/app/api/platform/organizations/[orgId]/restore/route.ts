import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    return Response.json(await coreFetch<{ changed: boolean }>(`/v1/platform/organizations/${orgId}/restore`, {
      method: "POST", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
