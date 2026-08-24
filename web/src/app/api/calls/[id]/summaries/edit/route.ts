import { coreFetch, errorResponse } from "@/server/core";

/**
 * A HUMAN's summary edit (0092): a NEW version authored 'human' — the
 * ladder keeps every previous version, the pointer moves by trigger.
 * Authority (the 0077 hierarchy) is the database door's, never this
 * file's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { body?: string };
    return Response.json(
      await coreFetch<{ version: number }>(
        `/v1/calls/${encodeURIComponent(id)}/summaries/edit`,
        { method: "POST", body: { body: body.body } },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
