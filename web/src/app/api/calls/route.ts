import { coreFetch, errorResponse } from "@/server/core";
import type { Call } from "@/api/types";

/**
 * GET /api/calls
 *
 * Pure pass-through of VISIBILITY: own + org-scoped, admins read all, enforced
 * by RLS in core/ and never re-implemented here. The BFF adds identity and
 * nothing else.
 *
 * **Two corrections, both found by reading core/ before trusting this file:**
 *
 * 1. core/ answers `{calls: [...]}`, not a bare array. This route declared
 *    `coreFetch<Call[]>` and handed the envelope straight through, so the
 *    client's `.filter()` would have thrown on an object — a type that was
 *    simply wrong about someone else's response, which is the whole reason
 *    `@echo/core/wire` exists. Unwrapped here so the client's contract (an
 *    array) stays true.
 * 2. **`?archived=` never existed on core/.** This route read the parameter,
 *    formatted it into the upstream URL, and core/ ignored it — its list has
 *    no archived filter at all and returns archived rows alongside the rest.
 *    A parameter that travels and does nothing is worse than a missing one:
 *    the toggle would have looked wired. Hiding archived rows is therefore a
 *    CLIENT concern, done on `archived_at`, and it is done there.
 *
 * `limit` is sent explicitly at core/'s maximum. Its default is 25, so the
 * list silently showed "everything" while capped at the 25 most recent —
 * **pagination is not built** (core/ pages by keyset on `before`), and 100 is
 * the honest ceiling until it is, not a fix for it.
 */
export async function GET() {
  try {
    const { calls } = await coreFetch<{ calls: Call[] }>("/v1/calls?limit=100");
    return Response.json(calls);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/calls — a new call row, status `recording` (Part 5).
 *
 * Identity only: title/scope/source pass through, core validates and RLS
 * scopes. The id that comes back is what every part upload and the finish
 * hang off.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string;
      scope?: string;
      source?: string;
      language?: string;
    };
    const created = await coreFetch<{ id: string }>("/v1/calls", {
      method: "POST",
      body: {
        title: body.title,
        scope: body.scope,
        source: body.source,
        language: body.language,
      },
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
