import { coreFetch, errorResponse } from "@/server/core";
import type { MailDraft } from "@/api/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<MailDraft>(`/v1/mail/drafts/${encodeURIComponent(id)}/discard`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
