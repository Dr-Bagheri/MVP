import { coreFetch, errorResponse } from "@/server/core";
import type { WorkflowCard } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<{ workflows: WorkflowCard[] }>("/v1/workflows"));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Org-authored workflow (0072) — admin-gated in core, forwarded verbatim. */
export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch<WorkflowCard>("/v1/workflows", {
        method: "POST",
        body: await request.json(),
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
