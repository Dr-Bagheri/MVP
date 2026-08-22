import { coreFetch, errorResponse } from "@/server/core";

/** Instant purge of an organization (db/0083) — root-walled in core AND SQL. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;
    const body = (await request.json()) as { reason?: string };
    return Response.json(
      await coreFetch<{ purged: boolean }>(
        `/v1/platform/organizations/${encodeURIComponent(orgId)}/purge`,
        { method: "POST", body: { reason: body.reason } },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
