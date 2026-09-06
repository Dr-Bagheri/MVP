import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { AuthoredWorkflow } from "@/api/types";

/** M41 P5 — the builder's list and the draft door (admin, core-walled). */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ workflows: AuthoredWorkflow[] }>("/v1/workflows/manage"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch<AuthoredWorkflow>("/v1/workflows/manage", {
        method: "POST", body: await readJson(request),
      }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
