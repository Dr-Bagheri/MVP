import { coreFetch, errorResponse } from "@/server/core";
import type { AgentCard } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<{ agents: AgentCard[] }>("/v1/agents"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return Response.json(await coreFetch<AgentCard>("/v1/agents", { method: "POST", body }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
