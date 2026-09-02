import { coreFetch, errorResponse } from "@/server/core";

/** Rename or retire a task topic — the meetings twin. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await coreFetch<null>(`/v1/tasks/topics/${encodeURIComponent(id)}`, {
      method: "PATCH", body: await request.json(),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
