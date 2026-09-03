import { coreFetch, errorResponse } from "@/server/core";
import type { AgentCard } from "@/api/types";

/**
 * The agents this person can call — and, since 0166, the door to make one.
 *
 * The POST left with the room picker on 2026-09-03 and came back the same day
 * with the workshop: core has served `POST /v1/agents` and `PATCH
 * /v1/agents/:id` since M47, and for one day nothing in this app reached them
 * — the producer-with-no-consumer shape, recorded in this file's own comment
 * while it was true. The Agents screen is the consumer now.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<{ agents: AgentCard[] }>("/v1/agents"));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await coreFetch<AgentCard>("/v1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await request.json()),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
