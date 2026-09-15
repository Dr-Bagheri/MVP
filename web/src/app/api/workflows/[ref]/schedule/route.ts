import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { WorkflowSchedule } from "@/api/client";

/**
 * M41 P4 — a workflow's standing cadence (2026-09-08).
 *
 * GET reads the schedules RLS shows this person on one workflow (own; an
 * admin also the org's) — the detail page's "Upcoming" is this, not the
 * trigger sentence re-printed. POST forwards `{ cadence, at_minute,
 * weekday }` untouched: core validates (a weekly cadence without its
 * weekday is refused by name), computes the first `next_due` in UTC, and
 * re-asserts that scheduling ANOTHER person's runs is management. Identity
 * forwarded; core decides — the same shape as the run route beside it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    const { ref } = await params;
    return Response.json(
      await coreFetch<{ schedules: WorkflowSchedule[] }>(
        `/v1/workflows/${encodeURIComponent(ref)}/schedule`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    const { ref } = await params;
    return Response.json(
      await coreFetch<{ schedule_id: string; next_due: string }>(
        `/v1/workflows/${encodeURIComponent(ref)}/schedule`,
        { method: "POST", body: await readJson(request) },
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
