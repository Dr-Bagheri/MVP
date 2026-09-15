import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { SeedJobStart, SeedReport } from "@echo/core/wire";

/** Re-seed the content for a new date — as a JOB, like the create (202 +
 *  a job id; the console polls `../jobs/[jobId]`). The ACCOUNTS survive, so
 *  the credentials shown once when it was created still sign in. `?wait=1`
 *  forwards the synchronous shape for scripts. */
export async function POST(
  request: Request, { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const wait = new URL(request.url).searchParams.get("wait") === "1";
  try {
    if (wait) {
      return Response.json(
        await coreFetch<{ report: SeedReport }>(`/v1/platform/demo-orgs/${orgId}/reseed?wait=1`, {
          method: "POST", body: await readJson(request),
        }),
      );
    }
    return Response.json(
      await coreFetch<SeedJobStart>(`/v1/platform/demo-orgs/${orgId}/reseed`, {
        method: "POST", body: await readJson(request),
      }),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
