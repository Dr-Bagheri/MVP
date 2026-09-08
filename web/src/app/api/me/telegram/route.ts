import { coreFetch, errorResponse } from "@/server/core";
import type { TelegramLinkRecord } from "@/api/types";

/**
 * The caller's own Telegram link (db/0212).
 *
 * There is no admin variant of either verb, here or in core: a link is a fact
 * about somebody's personal messaging account, and the policies scope every
 * row to `echo.actor_id()`. What this route adds is nothing — which is the
 * point.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<TelegramLinkRecord>("/v1/me/telegram"));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Unlink. 404 from core when there was nothing to unlink, forwarded as-is. */
export async function DELETE() {
  try {
    await coreFetch<null>("/v1/me/telegram", { method: "DELETE" });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
