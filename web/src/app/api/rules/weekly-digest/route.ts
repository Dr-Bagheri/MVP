import { coreFetch, errorResponse } from "@/server/core";

/** M35: the weekly-digest subscription — self-owned, one row per person. */
export async function GET() {
  try {
    return Response.json(await coreFetch("/v1/rules/weekly-digest"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    return Response.json(
      await coreFetch("/v1/rules/weekly-digest", { method: "PUT", body: await request.json() }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
