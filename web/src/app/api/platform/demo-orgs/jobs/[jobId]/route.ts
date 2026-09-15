import { coreFetch, errorResponse } from "@/server/core";
import type { SeedJobView } from "@echo/core/wire";

/**
 * One poll of a running seed (2026-09-09). The finished poll carries the
 * result — the presenter's password, for a create — and core FORGETS the job
 * as it delivers it, so a second poll is a 404 the console names plainly.
 * Nothing here logs the body.
 */
export async function GET(
  _request: Request, { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  try {
    return Response.json(
      await coreFetch<SeedJobView>(`/v1/platform/demo-orgs/jobs/${encodeURIComponent(jobId)}`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
