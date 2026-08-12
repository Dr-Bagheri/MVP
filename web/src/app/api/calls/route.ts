import { coreFetch, errorResponse } from "@/server/core";
import type { Call } from "@/api/types";

/**
 * GET /api/calls?archived=1
 *
 * Pure pass-through: the visibility rule (own + org-scoped; admins read all)
 * is RLS's job in core/, never a filter written here. The BFF adds identity
 * and nothing else.
 */
export async function GET(request: Request) {
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  try {
    const calls = await coreFetch<Call[]>(`/v1/calls?archived=${archived ? "1" : "0"}`);
    return Response.json(calls);
  } catch (error) {
    return errorResponse(error);
  }
}
