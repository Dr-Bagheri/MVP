import { coreFetch, errorResponse } from "@/server/core";
import type { AgentCard } from "@/api/types";

/**
 * The agents a person may call into a room (db/0164's picker reads this).
 *
 * THE POST WENT WITH THE EDITOR (2026-09-03). Creating an agent was the
 * browse-and-edit surface's door, and that surface is gone: the product now
 * calls agents into rooms rather than configuring them. Core still serves
 * `POST /v1/agents` and `PATCH /v1/agents/:id`; nothing in this app reaches
 * them, and leaving a BFF handler in front of a door with no room behind it
 * is exactly the shape the webhook removal found — a whole feature written,
 * reviewed, and never registered.
 */
export async function GET() {
  try {
    return Response.json(await coreFetch<{ agents: AgentCard[] }>("/v1/agents"));
  } catch (error) {
    return errorResponse(error);
  }
}
