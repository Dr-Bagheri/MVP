import { coreFetch, errorResponse } from "@/server/core";
import type { SummaryVersion } from "@/api/types";

/**
 * All versions, NEWEST FIRST. Regenerating adds a version and moves the
 * pointer — it never destroys the previous one (SPEC) — so this list is
 * append-only in practice and each entry carries the model that produced it
 * (the provenance invariant).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(
      await coreFetch<{ summaries: SummaryVersion[] }>(`/v1/calls/${id}/summaries`),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Regenerate as a NEW version (2026-08-23): optional template key +
 * requester instruction, forwarded verbatim — the ruled key list and the
 * length bound are core's to enforce, and a copy here would be a second
 * spelling of one rule.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      template?: string;
      instruction?: string;
      figures?: boolean;
      label?: string;
    };
    return Response.json(
      await coreFetch<{ id: string; status: string }>(
        `/v1/calls/${encodeURIComponent(id)}/summaries`,
        { method: "POST", body },
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
