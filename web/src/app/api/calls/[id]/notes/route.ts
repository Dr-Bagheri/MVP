import { coreFetch, errorResponse } from "@/server/core";
import type { CallNote } from "@/api/types";

/**
 * Notes & chapters on a call (0079). Identity passes through; core 404s an
 * unreadable call before listing, so an empty array here can only mean
 * "no notes" — the BFF adds nothing but the session.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { notes } = await coreFetch<{ notes: CallNote[] }>(
      `/v1/calls/${encodeURIComponent(id)}/notes`,
    );
    return Response.json(notes);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      kind?: string; at_ms?: number | null; body?: string;
    };
    const note = await coreFetch<CallNote>(
      `/v1/calls/${encodeURIComponent(id)}/notes`,
      {
        method: "POST",
        body: { kind: body.kind, at_ms: body.at_ms ?? null, body: body.body },
      },
    );
    return Response.json(note, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
