import { coreFetch, errorResponse } from "@/server/core";
import type { MailSourceMessage } from "@/api/types";

/** The message a draft answers. Read through, never cached here. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await coreFetch<MailSourceMessage>(`/v1/mail/drafts/${encodeURIComponent(id)}/source`));
  } catch (error) {
    return errorResponse(error);
  }
}
