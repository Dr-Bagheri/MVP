/* 0147 — the board's labels, history and roster: verbatim forwards, the
   session attached server-side. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/tasks/labels"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch("/v1/tasks/labels", {
      method: "POST", body: await request.json(),
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
