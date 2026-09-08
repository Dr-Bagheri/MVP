import { coreFetch, errorResponse, readJson } from "@/server/core";
import type { RecalledDecision } from "@/api/types";

/**
 * Live recall (item 7) — what the organisation already decided about what is
 * being said in this meeting right now.
 *
 * POST for a read, and the body is why: a window of a live transcript is
 * CONTENT. It must not reach a URL, a query string or an access log, and a
 * GET would put a meeting's words in all three.
 *
 * The PARSED body goes to `coreFetch`, which stringifies it itself. The first
 * version of this file passed `JSON.stringify(body)` — the exact defect
 * `bodyForward.guard` was written for on 2026-09-06, which core receives as a
 * JSON *string* and reads every field of as undefined. The guard caught it
 * the same hour it was written, which is the only reason it is not in
 * production.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<{ decisions: RecalledDecision[] }>(`/v1/meetings/${id}/recall`, {
        method: "POST",
        body: await readJson(request),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
