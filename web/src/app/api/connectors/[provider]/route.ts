import { coreFetch, errorResponse } from "@/server/core";

/**
 * Disconnect one provider — the BFF face of `DELETE /v1/connectors/:provider`
 * (M47). Core does the real work as the signed-in person: revoke at the
 * provider, empty the stored credential, mark the row revoked. This layer
 * carries identity and nothing else, same as every other connector route.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    await coreFetch<null>(
      `/v1/connectors/${encodeURIComponent((await params).provider)}`,
      { method: "DELETE" },
    );
    /* core answers 204 and so do we — a body here would be an invention */
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
