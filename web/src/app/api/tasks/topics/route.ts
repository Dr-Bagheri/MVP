/* 0144 — the task board's BFF: verbatim forwards, the session attached
   server-side. No filtering and no reshaping on this hop — the server owns
   the query and the wall. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/tasks/topics", { method: "POST", body: await readJson(request) }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
