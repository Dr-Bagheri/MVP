import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { DemoOrganization, DemoSeedResult, SeedJobStart } from "@echo/core/wire";

/** The demo tab's list — root-walled in core and again in the definer door. */
export async function GET() {
  try {
    return Response.json(
      await coreFetch<{ items: DemoOrganization[] }>("/v1/platform/demo-orgs"),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Seed one — as a JOB (2026-09-09). Core answers 202 with a job id at once
 * and the seed runs on for about four minutes; the console polls
 * `jobs/[jobId]` for the stage. The credentials arrive on the finished poll,
 * once, and never here. `?wait=1` forwards the synchronous shape (201 with
 * the result) for scripts; nothing here logs either body.
 */
export async function POST(request: Request) {
  const wait = new URL(request.url).searchParams.get("wait") === "1";
  try {
    if (wait) {
      return Response.json(
        await coreFetch<DemoSeedResult>("/v1/platform/demo-orgs?wait=1", {
          method: "POST", body: await readJson(request),
        }),
        { status: 201 },
      );
    }
    return Response.json(
      await coreFetch<SeedJobStart>("/v1/platform/demo-orgs", {
        method: "POST", body: await readJson(request),
      }),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
