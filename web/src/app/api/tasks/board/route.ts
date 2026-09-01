/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(request: Request) {
  try {
    const archived = new URL(request.url).searchParams.get("archived");
    const suffix = archived === "1" ? "?archived=1" : "";
    return Response.json(await coreFetch(`/v1/tasks/board${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}
