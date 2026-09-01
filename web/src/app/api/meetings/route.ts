/* 0145 — meetings' BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(request: Request) {
  try {
    const archived = new URL(request.url).searchParams.get("archived");
    const suffix = archived === "1" ? "?archived=1" : "";
    return Response.json(await coreFetch(`/v1/meetings${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch("/v1/meetings", {
      method: "POST", body: await request.json(),
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
