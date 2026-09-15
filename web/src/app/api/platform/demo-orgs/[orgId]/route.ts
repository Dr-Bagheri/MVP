import { coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * Remove a demo organisation whole — core soft-deletes it, sweeps its audio,
 * purges the rows through the existing door, and removes the auth identities
 * this feature minted. Identities that would not go come back NAMED.
 */
export async function DELETE(
  request: Request, { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  try {
    return Response.json(await coreFetch<{
      purged: boolean; identities_removed: number; identities_stranded: string[];
    }>(`/v1/platform/demo-orgs/${orgId}`, {
      method: "DELETE", body: await readJson(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
