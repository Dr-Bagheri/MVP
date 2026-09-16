/* 0226 — the project folders: verbatim forwards, the session attached
   server-side (the meeting folders' route, one domain over). */
import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/projects/folders"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/projects/folders", { method: "POST", body: await readJson(request) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
