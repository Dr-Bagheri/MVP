import { coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * Try a DRAFT skill once (item 16).
 *
 * POST, and the body carries the organisation's own procedure — content does
 * not go in a URL, a query string or an access log.
 *
 * The PARSED body goes to `coreFetch`, which stringifies it itself:
 * `JSON.stringify` here is the defect `bodyForward.guard` exists for, and
 * core would read every field as undefined.
 */
export async function POST(request: Request) {
  try {
    return Response.json(
      await coreFetch<{ text: string; model: string; run_id: string | null }>(
        "/v1/skills/dry-run",
        { method: "POST", body: await readJson(request) },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
