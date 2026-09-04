/* 0181 — projects: verbatim forwards, the session attached server-side. No
   filtering and no reshaping on this hop — the server owns the query and the
   wall. */
import { coreFetch, errorResponse } from "@/server/core";

export async function GET(request: Request) {
  try {
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    return Response.json(await coreFetch(`/v1/projects${archived ? "?archived=1" : ""}`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/projects", { method: "POST", body: await request.json() }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
