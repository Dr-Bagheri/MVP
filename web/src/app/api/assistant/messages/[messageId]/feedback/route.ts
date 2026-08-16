import { coreFetch, errorResponse } from "@/server/core";

/**
 * A verdict on one assistant turn (M27). Upserted server-side — pressing
 * the other thumb is a change of mind, never a conflict.
 */
export async function POST(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const body = (await request.json()) as { verdict?: string; note?: string };
  try {
    // core answers 204; `raw` because an empty body is not JSON to parse
    await coreFetch<Response>(`/v1/assistant/messages/${messageId}/feedback`, {
      method: "POST",
      body: { verdict: body.verdict, note: body.note },
      raw: true,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
