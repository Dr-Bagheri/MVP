import { coreFetch, errorResponse } from "@/server/core";

export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch<{ changed: boolean }>("/v1/platform/roots", {
      method: "POST", body: await request.json(),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
