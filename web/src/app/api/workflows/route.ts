import { coreFetch, errorResponse } from "@/server/core";
import type { WorkflowCard } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<{ workflows: WorkflowCard[] }>("/v1/workflows"));
  } catch (error) {
    return errorResponse(error);
  }
}
