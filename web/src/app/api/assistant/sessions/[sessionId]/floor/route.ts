import { coreFetch, errorResponse } from "@/server/core";

/** the × on the floor chip (db/0194): `agents: []` hands the thread back to Echo */
export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => ({}))) as { agents?: unknown };
  try {
    return Response.json(
      await coreFetch<{ floor: string[] }>(`/v1/assistant/sessions/${sessionId}/floor`, {
        method: "PUT",
        body: { agents: Array.isArray(body.agents) ? body.agents : [] },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
