import { coreFetch, errorResponse } from "@/server/core";
import type { MailDraft } from "@/api/types";

/**
 * The send. The only route in this app that puts a message outside the
 * building, and it carries NO BODY on purpose: what gets sent is the row the
 * person was shown, read again on the server. A client that could supply the
 * text could send something its owner never read.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<MailDraft>(`/v1/mail/drafts/${encodeURIComponent(id)}/send`, { method: "POST" }));
  } catch (error) {
    return errorResponse(error);
  }
}
