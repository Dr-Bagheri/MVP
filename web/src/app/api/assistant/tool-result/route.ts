import { coreFetch, errorResponse, readJson } from "@/server/core";

/** M33: forward the surface's answer to a client_tool_call. */
export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/assistant/tool-result", {
        method: "POST",
        body: await readJson(request),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
