import { coreFetch, errorResponse, readJson } from "@/server/core";

export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch<{ changed: boolean }>("/v1/platform/roots", {
      method: "POST", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
