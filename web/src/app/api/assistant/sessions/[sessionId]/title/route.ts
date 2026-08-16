import { coreFetch, errorResponse } from "@/server/core";
import type { AssistantSession } from "@/api/types";

/** Owner-rename (M27): the system never rewrites a title; the owner may. */
export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = (await request.json()) as { title?: string };
  try {
    return Response.json(
      await coreFetch<AssistantSession>(`/v1/assistant/sessions/${sessionId}/title`, {
        method: "PUT",
        body: { title: body.title },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
