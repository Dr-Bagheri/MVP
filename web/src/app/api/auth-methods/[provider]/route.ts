import { coreFetch, errorResponse } from "@/server/core";

/**
 * PATCH /api/auth-methods/:provider — flip one sign-in method (0078).
 * Identity passes through; the wall is core's requireAdmin AND the SQL
 * definer door beneath it. The BFF adds nothing but the session.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    const body = (await request.json()) as { enabled?: boolean };
    const result = await coreFetch<{ provider: string; enabled: boolean }>(
      `/v1/auth-methods/${encodeURIComponent(provider)}`,
      { method: "PATCH", body: { enabled: body.enabled } },
    );
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
