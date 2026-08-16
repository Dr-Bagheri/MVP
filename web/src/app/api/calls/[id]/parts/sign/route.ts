import { coreFetch, errorResponse } from "@/server/core";

/**
 * POST /api/calls/[id]/parts/sign — mint a signed upload URL for one part.
 *
 * The AUDIO BYTES never touch this route. Vercel's request ceiling is
 * smaller than one 30-minute part, so the browser PUTs directly to the URL
 * core signs (a single-object, expiring credential — the M10 signer
 * posture), then registers the part via the sibling route. This hop carries
 * identity and the tiny JSON envelope, nothing else.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { idx: number; content_type: string };
    return Response.json(
      await coreFetch(`/v1/calls/${id}/parts/sign`, {
        method: "POST",
        body: { idx: body.idx, content_type: body.content_type },
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
