import { coreFetch, errorResponse } from "@/server/core";
import type { CallScope, ModelInfo, Org } from "@/api/types";

export async function GET() {
  try {
    return Response.json(await coreFetch<Org>("/v1/admin/org"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Org settings and the model allow-list — the admin's cost lever, since
 * usage has no product UI (M15/M5).
 */
export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    default_call_scope?: CallScope;
    model?: { id: string; allowed: boolean };
  };
  try {
    if (body.model) {
      return Response.json(
        await coreFetch<ModelInfo[]>(`/v1/admin/models/${body.model.id}`, {
          method: "PATCH",
          body: { allowed: body.model.allowed },
        }),
      );
    }
    return Response.json(
      await coreFetch<Org>("/v1/admin/org", {
        method: "PATCH",
        body: { name: body.name, default_call_scope: body.default_call_scope },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
