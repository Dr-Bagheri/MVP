/* 0227 — a room for the task: POST makes the channel, seats the maker and
   points the card at it in ONE core transaction (the trigger seats whoever
   is already assigned). Taking a room off, or pointing at an existing one,
   is the card's own PATCH (`channel_id`), so this route has one verb. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    /* an unreadable body is a refusal, not a fault — readJson's one spelling
       (2026-09-06); a body is optional here (the room is named after the card) */
    const body = await readJson(request).catch(() => ({}));
    return Response.json(await coreFetch(`/v1/tasks/${encodeURIComponent(id)}/room`, {
      method: "POST", body,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
