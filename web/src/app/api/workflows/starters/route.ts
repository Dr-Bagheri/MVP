import { coreFetch, errorResponse } from "@/server/core";
import type { AuthoredWorkflow } from "@/api/types";

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
