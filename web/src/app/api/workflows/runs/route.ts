import { coreFetch, errorResponse } from "@/server/core";
import type { WorkflowRunRecord } from "@/api/types";

/** M41 P1 — the run ledger's list. RLS decides whose rows come back. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = new URLSearchParams();
    for (const key of ["before", "limit"]) {
      const value = url.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    return Response.json(
      await coreFetch<{ runs: WorkflowRunRecord[] }>(`/v1/workflows/runs${suffix}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
