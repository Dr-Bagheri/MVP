/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(request: Request) {
  try {
    const incoming = new URL(request.url).searchParams;
    const params = new URLSearchParams();
    if (incoming.get("archived") === "1") params.set("archived", "1");
    /* `seed=0` rides through untouched — a read tool's request not to
       create the default columns (2026-09-06) */
    if (incoming.get("seed") === "0") params.set("seed", "0");
    const query = params.toString();
    const suffix = query === "" ? "" : `?${query}`;
    return Response.json(await coreFetch(`/v1/tasks/board${suffix}`));
  } catch (error) {
    return errorResponse(error);
  }
}
