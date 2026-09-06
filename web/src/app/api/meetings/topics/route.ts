/* 0151 — the meeting folders: verbatim forwards, the session attached
   server-side. */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/meetings/topics"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/meetings/topics", { method: "POST", body: await readJson(request) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
