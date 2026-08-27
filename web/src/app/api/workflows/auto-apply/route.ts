import { coreFetch, errorResponse } from "@/server/core";

/** M41 W13/W17 — the standing decisions: read for members, PUT for admins. */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ rules: { kind: string; allowed: boolean }[] }>(
        "/v1/workflows/auto-apply"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    return Response.json(
      await coreFetch<{ kind: string; allowed: boolean }>(
        "/v1/workflows/auto-apply",
        { method: "PUT", body: await request.json() },
      ));
  } catch (error) {
    return errorResponse(error);
  }
}
