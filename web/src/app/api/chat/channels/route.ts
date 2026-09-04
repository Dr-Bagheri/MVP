/* 0184 — the team channel's BFF: verbatim forwards, the session attached
   server-side. The STREAM is not here and cannot be: every Vercel function is
   capped at 300 seconds on every plan, so a proxied SSE stream would die every
   five minutes forever. The browser opens that one against core directly with
   a ticket (see /api/chat/ticket). */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/chat/channels"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/chat/channels", { method: "POST", body: await request.json() }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
