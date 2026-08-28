import { coreFetch, errorResponse } from "@/server/core";
import type { AuthoredWorkflow, StarterWorkflow } from "@/api/types";

/**
 * The LIBRARY — every shipped starter, served by core straight from
 * STARTER_WORKFLOWS. Member-safe: reading the shelf is not the admin act,
 * installing (the POST below) is.
 */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ starters: StarterWorkflow[] }>("/v1/workflows/starters"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * M41 — install a SHIPPED starter (admin, core-walled): create + publish +
 * enable in one press, so the engine is never an empty shelf. A repeat
 * press is core's 409, named `starter_installed`.
 */
export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch<AuthoredWorkflow>("/v1/workflows/starters", {
        method: "POST", body: await request.json(),
      }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
