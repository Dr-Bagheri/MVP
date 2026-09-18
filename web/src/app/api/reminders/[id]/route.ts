/* 0231 — an alarm you set is an alarm you can take back. */
import { coreFetch, errorResponse } from "@/server/core";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await coreFetch(`/v1/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
