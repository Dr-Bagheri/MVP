import { coreFetch, errorResponse } from "@/server/core";

/**
 * Merge this person INTO another (db/0096's door, admin/owner only): the
 * loser keeps its id and points at the winner, and every voice it was
 * linked to moves. 204 on success; the door's refusals arrive as 403/404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { into?: string };
    await coreFetch<Response>(`/v1/directory/${encodeURIComponent(id)}/merge`, {
      method: "POST",
      body: { into: body.into },
      raw: true,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
