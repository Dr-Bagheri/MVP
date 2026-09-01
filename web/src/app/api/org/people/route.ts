/* 0147 — the board's labels, history and roster: verbatim forwards, the
   session attached server-side. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/org/people"));
  } catch (error) {
    return errorResponse(error);
  }
}
